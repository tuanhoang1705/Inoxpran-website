import { writable } from 'svelte/store';

// Feedback for navigations that leave the document entirely.
//
// A client-side navigation announces itself through beforeNavigate, which is what
// the route loader listens to. A full page navigation has no such signal in time to
// be useful: beforeNavigate's "leave" only fires once the browser starts unloading,
// and a browser does not unload the current page until the server has already
// answered. On a slow page that is several seconds after the tap - so the person
// tapping sees nothing happen, taps again, and only then does the page change.
//
// The click site announces the navigation here instead, before handing over to the
// browser, so the loader can appear on the same frame as the tap.

const fullPageNavigationPending = writable(false);

// If a navigation never happens - a beforeunload prompt was dismissed, the target
// refused to load - the overlay must not stay up forever over a working page.
const NAVIGATION_ABANDONED_MS = 15_000;
let abandonTimer = null;

const clearAbandonTimer = () => {
	if (abandonTimer === null) return;
	clearTimeout(abandonTimer);
	abandonTimer = null;
};

const endFullPageNavigation = () => {
	clearAbandonTimer();
	fullPageNavigationPending.set(false);
};

const beginFullPageNavigation = () => {
	if (typeof window === 'undefined') return;
	fullPageNavigationPending.set(true);
	clearAbandonTimer();
	abandonTimer = setTimeout(endFullPageNavigation, NAVIGATION_ABANDONED_MS);
};

/**
 * Shows the loader, then performs a full page navigation.
 *
 * The order matters: the store has to be set in the same synchronous turn as the
 * click, because once location.assign is called the browser owns the page.
 */
const navigateWithFeedback = (href) => {
	if (typeof window === 'undefined') return;
	const target = String(href || '').trim();
	if (!target) return;
	beginFullPageNavigation();
	window.location.assign(target);
};

export {
	fullPageNavigationPending,
	beginFullPageNavigation,
	endFullPageNavigation,
	navigateWithFeedback
};
