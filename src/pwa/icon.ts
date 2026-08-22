/**
 * SVG icon for herdweb PWA.
 * Pixel-art R> on catppuccin mocha base (#1e1e2e).
 * Green R (#a6e3a1), blue chevron (#89b4fa).
 * Uses <rect> elements — renders identically on all platforms.
 */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="#1e1e2e"/>
  <g fill="#a6e3a1">
    <rect x="76" y="130" width="28" height="28" rx="4"/>
    <rect x="112" y="130" width="28" height="28" rx="4"/>
    <rect x="148" y="130" width="28" height="28" rx="4"/>
    <rect x="184" y="130" width="28" height="28" rx="4"/>
    <rect x="76" y="166" width="28" height="28" rx="4"/>
    <rect x="220" y="166" width="28" height="28" rx="4"/>
    <rect x="76" y="202" width="28" height="28" rx="4"/>
    <rect x="220" y="202" width="28" height="28" rx="4"/>
    <rect x="76" y="238" width="28" height="28" rx="4"/>
    <rect x="112" y="238" width="28" height="28" rx="4"/>
    <rect x="148" y="238" width="28" height="28" rx="4"/>
    <rect x="184" y="238" width="28" height="28" rx="4"/>
    <rect x="76" y="274" width="28" height="28" rx="4"/>
    <rect x="148" y="274" width="28" height="28" rx="4"/>
    <rect x="76" y="310" width="28" height="28" rx="4"/>
    <rect x="184" y="310" width="28" height="28" rx="4"/>
    <rect x="76" y="346" width="28" height="28" rx="4"/>
    <rect x="220" y="346" width="28" height="28" rx="4"/>
  </g>
  <g fill="#89b4fa">
    <rect x="328" y="166" width="28" height="28" rx="4"/>
    <rect x="364" y="202" width="28" height="28" rx="4"/>
    <rect x="400" y="238" width="28" height="28" rx="4"/>
    <rect x="364" y="274" width="28" height="28" rx="4"/>
    <rect x="328" y="310" width="28" height="28" rx="4"/>
  </g>
</svg>`

/** Convert SVG string to a data URI */
export function svgToDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
