"use client";

import { useMe, usePlans } from "@/lib/hooks/queries";
import { usePublicSettings } from "@/lib/hooks/usePublicSettings";
import { cn } from "@/lib/utils";

/**
 * A place an ad may appear.
 *
 * Four things all have to be true, and each is decided by data rather than by
 * hardcoding "free plan sees ads":
 *
 *   1. the master switch is on            (system_settings.ads_enabled)
 *   2. this placement is enabled          (system_settings.ads_config.placements)
 *   3. an ad provider is configured       (system_settings.ads_config.providerId)
 *   4. the account's plan is ad-supported (plans.shows_ads)
 *
 * Point 4 is the product rule — free accounts see ads, paid ones do not — and it now
 * follows the plan an admin edits, so making a plan ad-free is a checkbox rather
 * than a deploy.
 *
 * When nothing is configured this renders nothing at all. It deliberately does not
 * draw a grey box labelled "Advertisement": an empty frame that will never be
 * filled is a fake UI element, and the product rules forbid those.
 *
 * The container is what a provider's script fills. Nothing here loads a third-party
 * script yet — when one is integrated, this is the single place it attaches.
 */
export function AdSlot({ placement, className }: { placement: string; className?: string }) {
  const { data: settings } = usePublicSettings();
  const { data: me } = useMe();
  const { data: plans } = usePlans();

  if (!settings?.ads_enabled) return null;

  const config = settings.ads_config;
  if (!config?.providerId) return null;
  if (!config.placements?.[placement]) return null;

  // Until the plan is known, show nothing. Guessing wrong means briefly showing an
  // ad to somebody who paid not to see one.
  if (!me || !plans) return null;
  const plan = plans.find((p) => p.id === me.planId);
  if (!plan?.showsAds) return null;

  return (
    <div
      data-ad-placement={placement}
      data-ad-provider={config.providerId}
      className={cn("overflow-hidden rounded-lg border border-border bg-surface-2", className)}
    >
      <span className="sr-only">Advertisement</span>
    </div>
  );
}
