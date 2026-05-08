"use client";

import dynamic from "next/dynamic";

// Lazy, client-only mounts. Neither the toaster nor the onboarding tour
// is needed for first paint, and shipping them in the SSR HTML adds JS to
// the critical bundle. ssr:false defers them until after hydration so the
// chunks load in idle time, off the LCP path. Saves ~9 kB (sonner) on
// first-load JS for visitors who never see a toast or the tour.
//
// Lives in a client component because Next 15 disallows `ssr: false` on
// `next/dynamic` from a server component.
const Toaster = dynamic(() => import("sonner").then((m) => m.Toaster), {
  ssr: false,
  loading: () => null,
});

const OnboardingTour = dynamic(
  () => import("./OnboardingTour").then((m) => m.OnboardingTour),
  { ssr: false, loading: () => null },
);

export function DeferredOnboardingTour() {
  return <OnboardingTour />;
}

export function DeferredToaster() {
  return (
    <Toaster
      position="top-right"
      richColors
      theme="light"
      toastOptions={{
        style: {
          background: "var(--de-bg-raised)",
          color: "var(--de-ink)",
          border: "1px solid var(--de-line-2)",
        },
      }}
    />
  );
}
