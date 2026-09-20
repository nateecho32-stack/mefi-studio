"""Tree-rail keyboard + ARIA contracts for Mefi's Studio AI+ (renderer/tree3d.js).

The 3D tree rail is a canvas, so its keyboard and screen-reader surface is
wired by hand: the template must ship `#tree-canvas` as a labelled, focusable
`role="tree"` container, init() must own a hidden `role="treeitem"` proxy via
`aria-owns`, `onCanvasKeyDown` must keep the arrow walk and the Enter/Space
activation through the same `activateNode` path the mouse uses, and
`setKbdFocus` must keep the roving `aria-activedescendant` on that proxy.
These are the bindings a refactor is most likely to drop silently, so each is
pinned structurally: removing any of them fails this file. The behavioral half
(`tests/tree3d_keyboard.test.mjs`) drives the keys for real.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
TREE = STUDIO / "renderer" / "tree3d.js"


def _function_body(source, name):
    """The braces-balanced body of `function name(` in `source` (or "")."""
    match = re.search(r"function\s+" + re.escape(name) + r"\s*\(", source)
    if not match:
        return ""
    depth = 1
    index = match.end()
    while index < len(source) and depth:
        if source[index] == "(":
            depth += 1
        elif source[index] == ")":
            depth -= 1
        index += 1
    start = source.index("{", index)
    depth = 0
    for index in range(start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    return source[start:]


class MefiStudioTreeKeyboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tree = TREE.read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def _canvas_tag(self):
        for line in self.template.splitlines():
            if 'id="tree-canvas"' in line:
                return line
        return ""

    # ---- binding 1: the container is a labelled, focusable tree ----------

    def test_template_ships_a_labelled_focusable_tree_container(self):
        tag = self._canvas_tag()
        self.assertIn('id="tree-canvas"', tag, "the booklet template must ship the tree-canvas element")
        self.assertIn('tabindex="0"', tag, "the tree canvas must be one keyboard tab stop")
        self.assertIn('role="tree"', tag, "the tree canvas must carry the tree role")
        self.assertIn('aria-label="Session tree"', tag, "the tree container must be labelled")

    def test_init_wires_the_tree_role_and_its_hidden_treeitem(self):
        init = _function_body(self.tree, "init")
        self.assertTrue(init, "tree3d.js must keep an init() function")
        self.assertIn('canvas.setAttribute("tabindex", "0");', init)
        self.assertIn('canvas.setAttribute("role", "tree");', init)
        self.assertIn('canvas.setAttribute("aria-label", "Session tree");', init)
        self.assertIn('kbdProxy.setAttribute("role", "treeitem");', init, "the roving activedescendant needs a treeitem to point at")
        self.assertIn('canvas.setAttribute("aria-owns", "tree-kbd-item");', init, "the proxy is not a canvas child, so the canvas must own it")

    # ---- binding 2: arrows navigate, Enter/Space activate ----------------

    def test_arrow_keys_walk_the_nodes(self):
        handler = _function_body(self.tree, "onCanvasKeyDown")
        self.assertTrue(handler, "onCanvasKeyDown must exist")
        for key in ("ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"):
            self.assertIn(f'event.key === "{key}"', handler, f"the keydown handler must keep a {key} branch")
        self.assertIn("moveKbdFocus(1);", handler)
        self.assertIn("moveKbdFocus(-1);", handler)
        walk = _function_body(self.tree, "moveKbdFocus")
        self.assertIn("nodes.length", walk, "the walk must wrap inside the current graph")
        self.assertIn('canvas.addEventListener("keydown", onCanvasKeyDown);', self.tree)

    def test_enter_and_space_activate_through_the_click_path(self):
        handler = _function_body(self.tree, "onCanvasKeyDown")
        enter = handler.split('event.key === "Enter" || event.key === " "', 1)
        self.assertEqual(2, len(enter), "the keydown handler must keep an Enter/Space branch")
        self.assertIn("event.preventDefault();", enter[1], "Enter/Space must not scroll or submit anything else")
        self.assertIn("activateNode(kbdFocus);", enter[1], "Enter/Space must activate the focused node")
        self.assertIn("function activateNode(", self.tree)
        self.assertIn('canvas.addEventListener("click", () => activateNode(hover));', self.tree, "the mouse must use the same activation path")
        activation = _function_body(self.tree, "activateNode")
        self.assertIn('"mefi:tree-select"', activation, "activation must move the session selection")

    def test_escape_drops_the_focus(self):
        handler = _function_body(self.tree, "onCanvasKeyDown")
        escape = handler.split('event.key === "Escape"', 1)
        self.assertEqual(2, len(escape), "the keydown handler must keep an Escape branch")
        self.assertIn("setKbdFocus(null);", escape[1])

    # ---- binding 3: the roving activedescendant ---------------------------

    def test_set_kbd_focus_keeps_the_activedescendant_labelled(self):
        setter = _function_body(self.tree, "setKbdFocus")
        self.assertTrue(setter, "setKbdFocus must exist")
        self.assertIn('canvas.setAttribute("aria-activedescendant", "tree-kbd-item");', setter)
        self.assertIn('canvas.removeAttribute("aria-activedescendant");', setter, "a dropped focus must clear the attribute")
        self.assertIn('kbdProxy.setAttribute("aria-label", kbdLabel(kbdFocus));', setter, "the proxy must carry the focused node's label")
        self.assertIn('kbdProxy.setAttribute("aria-selected"', setter, "sessions and todos must report their selection state")
        self.assertIn("hover = kbdFocus;", setter, "sighted keyboard users get the tooltip and ring too")

    def test_focus_follows_a_rebuild(self):
        build = _function_body(self.tree, "buildGraphImpl")
        self.assertIn("if (kbdFocus) setKbdFocus(findNodeById(kbdFocus.id));", build, "keyboard focus must follow its node across a rebuild")
        wrapper = _function_body(self.tree, "buildGraph")
        self.assertIn("buildGraphImpl(sessions, todos, fallback)", wrapper, "buildGraph must still run the pinned rebuild body")

    # ---- housekeeping ----------------------------------------------------

    def test_registration(self):
        self.assertIn("`tools/test_mefi_studio_tree_keyboard.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
