/**
 * Direction-aware screen transitions gives client-side navigations a
 * native-app feel. `src/app/template.tsx` applies the returned class to
 * each freshly mounted screen.
 *
 * Direction is inferred from a screen-depth hierarchy, so no per-link
 * wiring is needed anywhere:
 *
 *   depth 0 entry:  "/", "/welcome"
 *   depth 1 tabs:   "/{slug}/inbox", "/sent", "/profile"
 *   depth 2 detail: thread, "/settings", "/help", "/{slug}" (sender chat)
 *
 * deeper → push (slide in from right) · shallower → pop (slide in from
 * left) · same depth → quick cross-fade (tab switch).
 */

const TAB_PATTERNS = [/^\/[^/]+\/inbox$/, /^\/sent$/, /^\/profile$/];

function depth(path: string): number {
  if (path === "/" || path === "/welcome") return 0;
  if (TAB_PATTERNS.some((re) => re.test(path))) return 1;
  return 2;
}

let lastPath: string | null = null;
let lastAnim = "";

export function getScreenAnimation(path: string): string {
  // Same path asked twice (StrictMode double-effects, re-renders) return
  // the same answer instead of treating it as a new navigation.
  if (path === lastPath) return lastAnim;

  const prev = lastPath;
  lastPath = path;

  if (prev === null) {
    lastAnim = ""; // first paint of the session no animation
  } else {
    const delta = depth(path) - depth(prev);
    lastAnim =
      delta > 0 ? "anim-screen-push" : delta < 0 ? "anim-screen-pop" : "anim-screen-tab";
  }
  return lastAnim;
}
