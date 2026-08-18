import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// vitest runs from the project root; happy-dom rewrites import.meta.url, so
// resolve from cwd instead of import.meta
const css = readFileSync(resolve(process.cwd(), 'styles/base.css'), 'utf8')

/** Extract the first declaration block for a selector */
function blockFor(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
	expect(match, `selector ${selector} not found in base.css`).not.toBeNull()
	return match?.[1] ?? ''
}

describe('base.css safe-area coverage', () => {
	test('floating font controls CSS is removed', () => {
		expect(css).not.toContain('#wt-font-controls')
	})

	test('top-positioned floating groups respect the top inset', () => {
		for (const selector of [
			'.wt-floating-top-left',
			'.wt-floating-top-right',
			'.wt-floating-top-centre',
		]) {
			expect(blockFor(selector)).toContain('env(safe-area-inset-top, 0px)')
		}
	})

	test('left/right-positioned floating groups respect the side insets', () => {
		for (const selector of [
			'.wt-floating-top-left',
			'.wt-floating-bottom-left',
			'.wt-floating-centre-left',
		]) {
			expect(blockFor(selector)).toContain('env(safe-area-inset-left, 0px)')
		}
		for (const selector of [
			'.wt-floating-top-right',
			'.wt-floating-bottom-right',
			'.wt-floating-centre-right',
		]) {
			expect(blockFor(selector)).toContain('env(safe-area-inset-right, 0px)')
		}
	})

	test('scroll buttons respect the right inset', () => {
		expect(blockFor('#wt-scroll-buttons')).toContain('env(safe-area-inset-right, 0px)')
	})

	test('existing bottom inset coverage is preserved', () => {
		expect(blockFor('#wt-toolbar')).toContain('env(safe-area-inset-bottom, 0px)')
		expect(blockFor('.wt-floating-bottom-left')).toContain('env(safe-area-inset-bottom, 0px)')
	})
})
