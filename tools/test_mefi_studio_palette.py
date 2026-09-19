"""Command palette contracts for Mefi's Studio AI+ (renderer/palette.js).

The palette is keyboard-first: Escape must always close it (and hand focus
back to the opener), and the roving `aria-activedescendant` must live on the
`#palette-input` element itself — the focused combobox a screen reader watches
— not only on the listbox, and it must track the highlight on every arrow
press. Pointer users get the opposite bargain: hovering and clicking highlight
rows without ever moving focus, so the only outline the palette ships sits
under `:focus-visible`, pinned in `styles.css` and the built `booklet.html`.
These are the bindings a refactor is most likely to drop silently, so each is
pinned structurally: removing any of them makes this file fail.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
PALETTE = STUDIO / "renderer" / "palette.js"
STYLES = STUDIO / "renderer" / "styles.css"
BOOKLET = STUDIO / "renderer" / "booklet.html"


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


class MefiStudioPaletteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.palette = PALETTE.read_text(encoding="utf-8")
        cls.template = (STUDIO / "renderer" / "booklet.template.html").read_text(encoding="utf-8")
        cls.styles = STYLES.read_text(encoding="utf-8")
        cls.booklet = BOOKLET.read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    # ---- binding 1: Escape closes ---------------------------------------

    def test_escape_closes_the_palette(self):
        init = _function_body(self.palette, "init")
        self.assertTrue(init, "palette.js must keep an init() function")
        handler = init.split('window.addEventListener("keydown"', 1)
        self.assertEqual(2, len(handler), "init() must register the window keydown handler")
        handler = handler[1]
        branch = handler.split('event.key === "Escape"', 1)
        self.assertEqual(2, len(branch), "the keydown handler must keep an Escape branch")
        branch = branch[1]
        self.assertIn("event.preventDefault();", branch, "Escape must not bubble to the page behind the palette")
        self.assertLess(
            branch.index("event.preventDefault();"),
            branch.index("close();"),
            "the Escape branch must call close() after preventing the default",
        )
        self.assertIn("function close()", self.palette)

    # ---- binding 2: aria-activedescendant on the palette input ----------

    def test_aria_activedescendant_is_bound_to_the_palette_input_id(self):
        init = _function_body(self.palette, "init")
        self.assertIn(
            'el.input = document.getElementById("palette-input");',
            init,
            "the palette input must be bound by its palette-input id",
        )
        self.assertIn('id="palette-input"', self.template, "the booklet template must ship the palette-input element")
        active = _function_body(self.palette, "setActiveOption")
        self.assertTrue(active, "setActiveOption must exist")
        self.assertIn(
            'el.input.setAttribute("aria-activedescendant", active.id);',
            active,
            "the active option id must be mirrored onto the palette input, not only the listbox",
        )
        self.assertIn(
            'el.input.removeAttribute("aria-activedescendant");',
            active,
            "an empty result list must clear the attribute from the input too",
        )
        close = _function_body(self.palette, "close")
        self.assertIn(
            'el.input.removeAttribute("aria-activedescendant");',
            close,
            "closing the palette must clear the attribute from the input",
        )
        # The combobox role is what makes the input/activedescendant pair the
        # announced focus; without it the mirrored attribute is inert.
        self.assertIn('el.input.setAttribute("role", "combobox");', init)

    # ---- binding 3: the activedescendant tracks the highlight -----------

    def test_render_marks_the_highlighted_option_for_the_activedescendant(self):
        render = _function_body(self.palette, "render")
        self.assertTrue(render, "palette.js must keep a render() function")
        self.assertIn(
            'li.id = `palette-option-${index}`;',
            render,
            "each option row needs the id the activedescendant points at",
        )
        self.assertIn('li.setAttribute("role", "option");', render)
        self.assertIn(
            'li.setAttribute("aria-selected", String(index === state.index));',
            render,
            "aria-selected must report the same row the highlight does",
        )
        self.assertIn(
            'if (index === state.index) li.classList.add("active");',
            render,
            "the .active class must be the single source the attribute is read from",
        )
        self.assertGreaterEqual(
            render.count("setActiveOption();"),
            2,
            "render must refresh the activedescendant on the empty path and after building rows",
        )
        active = _function_body(self.palette, "setActiveOption")
        self.assertIn(
            'const active = el.list.querySelector("li.active");',
            active,
            "setActiveOption must read the highlighted row, so the attribute tracks the highlight",
        )

    def test_arrow_keys_move_the_highlight_and_re_render(self):
        init = _function_body(self.palette, "init")
        handler = init.split('window.addEventListener("keydown"', 1)[1]
        wrap = (
            "state.index = event.key === \"ArrowDown\" ? (state.index + 1) % span"
            " : (state.index - 1 + span) % span;"
        )
        for key in ("ArrowDown", "ArrowUp"):
            branch = handler.split(f'event.key === "{key}"', 1)
            self.assertEqual(2, len(branch), f"the keydown handler must keep an {key} branch")
            branch = branch[1].split("} else if", 1)[0]
            self.assertIn("event.preventDefault();", branch, f"{key} must not scroll the page behind the palette")
            self.assertIn(
                "const span = Math.min(40, state.filtered.length);",
                branch,
                f"{key} must wrap within the rows the palette actually shows",
            )
            self.assertIn("if (!span) return;", branch, f"{key} must survive an empty result list")
            self.assertIn(wrap, branch, f"{key} must wrap the highlight around both ends of the list")
            self.assertIn("render();", branch, f"{key} must re-render so the activedescendant follows")
            self.assertLess(
                branch.index(wrap),
                branch.index("render();"),
                f"{key} must move the highlight before re-rendering",
            )

    # ---- binding 4: Escape hands focus back to the opener ---------------

    def test_escape_restores_the_opener_focus(self):
        open_body = _function_body(self.palette, "open")
        self.assertTrue(open_body, "palette.js must keep an open() function")
        self.assertIn(
            "state.opener = document.activeElement;",
            open_body,
            "open() must remember the control the user came from",
        )
        self.assertIn('window.MefiNav?.claim?.("palette");', open_body)
        self.assertIn("el.input.focus();", open_body, "opening must move focus to the combobox input")

        close = _function_body(self.palette, "close")
        self.assertIn("restoreOpener();", close, "every close path must run the opener restore")
        self.assertLess(
            close.index('window.MefiNav?.release?.("palette");'),
            close.index("restoreOpener();"),
            "the restore must run after the nav layer is released, so a surface nav focuses wins",
        )

        restore = _function_body(self.palette, "restoreOpener")
        self.assertTrue(restore, "restoreOpener must exist")
        self.assertIn(
            "const stranded = !current || current === document.body || el.overlay.contains(current);",
            restore,
            "the restore must step in only when nothing usable took focus",
        )
        self.assertIn("state.opener = null;", restore, "the opener must be dropped so a later close cannot reuse it")
        for guard in ("opener !== document.body", "opener.isConnected", '!opener.closest?.("[hidden]")'):
            self.assertIn(guard, restore, f"the restore must refuse a stranded-refocus on {guard}")
        self.assertIn("opener.focus();", restore, "a stranded keyboard user must land back on the opener")

    # ---- binding 5: pointer users highlight without focus rings ---------

    def test_pointer_paths_never_move_focus(self):
        render = _function_body(self.palette, "render")
        self.assertIn('li.addEventListener("mouseenter"', render, "hover must drive the highlight")
        self.assertIn('li.addEventListener("click", () => run(index));', render, "click must activate the row")
        self.assertNotIn(
            ".focus(",
            render,
            "hover/click handlers must not move focus; the highlight alone follows the pointer",
        )
        self.assertNotIn(
            "tabindex",
            render,
            "option rows must never become tab stops; focus stays on the combobox input",
        )

    def test_the_palette_ships_no_plain_focus_outline(self):
        # The keyboard ring lives on :focus-visible only; plain :focus
        # actively suppresses the shared input ring (box-shadow) instead of
        # adding one, so a pointer focus draws no ring of its own.
        self.assertIn(
            ".palette-sheet input:focus { box-shadow: none; border-color: var(--hairline); }",
            self.styles,
            "plain focus on the palette input must suppress the shared input ring",
        )
        self.assertNotIn(
            ".palette-sheet input:focus { outline",
            self.styles,
            "plain focus must not draw an outline on the palette input",
        )
        self.assertIn(
            ".palette-sheet input:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: -2px; }",
            self.styles,
            "keyboard focus keeps the inset gold ring on the palette input",
        )
        self.assertIn(
            "#palette-list li:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: -2px; }",
            self.styles,
            "option rows carry only the degenerate :focus-visible ring",
        )
        self.assertNotIn(
            "#palette-list li:focus {",
            self.styles,
            "option rows must have no plain-focus outline rule",
        )
        # The built booklet bakes styles.css verbatim; pin both so a stale
        # build cannot ship a different focus story than the source.
        for snippet in (
            ".palette-sheet input:focus { box-shadow: none; border-color: var(--hairline); }",
            ".palette-sheet input:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: -2px; }",
            "#palette-list li:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: -2px; }",
        ):
            self.assertIn(snippet, self.booklet, f"the built booklet must keep the palette focus contract: {snippet}")

    # ---- housekeeping ----------------------------------------------------

    def test_registration(self):
        self.assertIn("`tools/test_mefi_studio_palette.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
