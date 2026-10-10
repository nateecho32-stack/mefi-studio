# Discord reaction artwork

The nine supplied Studio mascot originals live in `../stickers/`. This folder
adds two matching meme reactions, **Side-eye** and **Buffering**, generated with
the built-in imagegen tool on 2026-10-10. These are Discord additions; they do
not grant any Studio collectible or rare finish. Four transparent pet images
are native exports of Studio's dragon, cloud dragon, phoenix and wisp painter.

Run `powershell -File tools/export-discord-assets.ps1` from the repository to
export transparent 128 x 128 emojis and 320 x 320 stickers under the ignored
`tools/logs/discord-pack/` folder. It preserves the artwork and fits it inside
a square, checks each PNG against a conservative 256 KiB ceiling and writes a
manifest. The four native pet previews are included. Originals stay unchanged.

Before uploading, inspect the server's current emoji and sticker counts.
Only fill available slots; preserve existing server assets. The upload and
Monthly Supporter role creation remain separate server operations.

The requested role is **Monthly Supporter**, with no additional Discord
permissions, no separate member-list placement and no public mentionability.
Membership verification is configured separately in the private service.
Creating a Discord role alone does not connect billing or grant a collectible
entitlement. The membership provider must maintain its current membership list.

For available emoji slots, prioritize the nine originals, then Side-eye and
Buffering, then the four pets. If five sticker slots are free, the proposed
selection is Celebrate, Love, Side-eye, Buffering and the dragon pet. Reduce
that selection to the actual free count; never remove another server asset
to make room. The extra exports are alternatives, not instructions to upload
all fifteen stickers.

## Generation prompts

Both calls used `studio-curious.png` as the character/style reference and
`transparent_background: true`.

**Side-eye**

Use case: stylized-concept. Create one Discord meme reaction emoji/sticker on
a truly transparent background. The attached image is a character and style
reference, not a layout to copy. Keep the glossy charcoal-black orb, thick warm
pale-gold outline and orbital rings, mint-green little satellites, and gold
expressive eyes. New pose: a big exaggerated skeptical side-eye, one eye half
closed and the other eye looking sideways, one small mint hand under chin;
a single gold question mark above. Bold simple shapes readable at 32 pixels.
Tight centered square composition with safe transparent margin, no background,
no checkerboard, no text, no watermark, no multi-panel sheet. Warm funny
skeptical mood. Preserve the cute mascot identity and strong gold/mint contrast.

**Buffering**

Use case: stylized-concept. One Discord meme reaction sticker/emoji on truly
transparent background, square. Input is the character/style reference: cute
glossy charcoal-black orb mascot with thick warm gold outline, gold orbital
rings, mint satellites and gold expressive eyes. New reaction: comically
overwhelmed 'brain buffering' expression, asymmetrical wide eyes, tiny dazed
open mouth, two or three chunky gold and mint dots orbiting above like a stalled
loading indicator; one orbital ring humorously askew. Keep charming, funny and
cute, not scary. Large simple shapes readable at tiny emoji size, thick clean
outlines, restrained glossy shading consistent with input, tightly centered
with safe transparent margin. No words, text, computer UI, extra characters,
checkerboard or watermark. One complete cutout character, not a sheet.
