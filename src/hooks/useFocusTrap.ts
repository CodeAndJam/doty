import { type RefObject, useEffect } from 'react'

/**
 * Keep Tab inside a dialog. The app behind an overlay is still in the tab order,
 * so without this the DM can tab into controls they cannot see.
 *
 * Elements with `tabindex="-1"` (inactive tabs, the overlay root) are not stops.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !root) return
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0 && el.tabIndex >= 0)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = active instanceof HTMLElement && root.contains(active)

      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [ref])
}
