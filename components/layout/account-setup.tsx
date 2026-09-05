"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/lib/store/toast";
import { apiClient } from "@/lib/api/client";
import { useAuthStore } from "@/lib/store/auth";
import { COUNTRIES, countryByCode, flagOf, guessCountry } from "@/lib/countries";
import { Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Setup {
  countryCode: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  address: string | null;
  isComplete: boolean;
}

/**
 * Asked once, after registration.
 *
 * A modal rather than a page in the sign-up flow, because someone who has just
 * created an account has already decided to be here — putting another required
 * screen between them and their files loses people. It can be dismissed and comes
 * back next time, and every screen still works without it.
 *
 * The country is guessed from the browser's own locale and time zone rather than
 * an IP lookup: no third party is told who is signing up, nothing has to be
 * reachable for the form to work, and the guess is only a default.
 */
export function AccountSetup() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [dial, setDial] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [pickingCountry, setPickingCountry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whether the user has typed a calling code themselves. Until they do, changing
  // the country updates it; afterwards it is left alone, because someone who kept
  // a foreign number should not have it overwritten.
  const dialTouched = useRef(false);

  useEffect(() => {
    if (!user || checked) return;
    setChecked(true);

    apiClient
      .get<Setup>("/api/auth/setup")
      .then((data) => {
        if (data.isComplete) return;
        const guess = data.countryCode ?? guessCountry();
        setCountryCode(guess);
        setDial(data.phoneCountryCode ?? countryByCode(guess)?.dial ?? "");
        setPhone(data.phoneNumber ?? "");
        setAddress(data.address ?? "");
        setOpen(true);
      })
      .catch(() => {
        // Never block the app on this. If the check fails the user simply is not
        // asked, and the prompt in Settings still gets them there.
      });
  }, [user, checked]);

  const filtered = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.code.toLowerCase() === q);
  }, [countryQuery]);

  const chooseCountry = (code: string) => {
    setCountryCode(code);
    if (!dialTouched.current) setDial(countryByCode(code)?.dial ?? "");
    setPickingCountry(false);
    setCountryQuery("");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.put("/api/auth/setup", {
        countryCode,
        phoneCountryCode: dial,
        phoneNumber: phone,
        address,
      });
      toast.success("Account set up", "You can change these any time in Settings.");
      setOpen(false);
    } catch (e) {
      // The server names the field that is wrong; showing that beats "invalid".
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  const selected = countryByCode(countryCode);

  return (
    <Dialog
      open
      onClose={() => setOpen(false)}
      title="Finish setting up"
      description="Three details, so billing and support know where you are."
    >
      <div className="space-y-4">
        <div>
          <Label>Country</Label>
          {pickingCountry ? (
            <div className="mt-1.5 rounded-lg border border-border">
              <div className="relative border-b border-border">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={countryQuery}
                  onChange={(e) => setCountryQuery(e.target.value)}
                  placeholder="Search countries…"
                  className="h-10 w-full bg-transparent pl-8 pr-3 text-sm text-foreground outline-none"
                />
              </div>
              <div className="max-h-56 overflow-auto p-1">
                {filtered.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">No country matches that.</p>
                ) : (
                  filtered.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => chooseCountry(c.code)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2",
                        c.code === countryCode && "bg-primary-soft",
                      )}
                    >
                      <span aria-hidden className="text-base">{flagOf(c.code)}</span>
                      <span className="flex-1 truncate text-foreground">{c.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{c.dial}</span>
                      {c.code === countryCode && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setPickingCountry(true)}
              className="mt-1.5 flex h-10 w-full items-center gap-2.5 rounded-md border border-border bg-surface px-3 text-left text-sm"
            >
              {selected ? (
                <>
                  <span aria-hidden className="text-base">{flagOf(selected.code)}</span>
                  <span className="flex-1 truncate text-foreground">{selected.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{selected.dial}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Choose your country</span>
              )}
            </button>
          )}
        </div>

        <div>
          <Label htmlFor="setup-phone">Phone number</Label>
          <div className="mt-1.5 flex gap-2">
            <input
              aria-label="Country calling code"
              value={dial}
              onChange={(e) => {
                dialTouched.current = true;
                setDial(e.target.value);
              }}
              className="h-10 w-20 rounded-md border border-border bg-surface px-2 text-center text-sm text-foreground tabular-nums"
            />
            <Input
              id="setup-phone"
              inputMode="tel"
              placeholder="1712 345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="flex-1"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="setup-address">Address</Label>
          <textarea
            id="setup-address"
            rows={3}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, city, postcode"
            className="mt-1.5 w-full rounded-md border border-border bg-surface p-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        {error && <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          {/* Dismissible on purpose: nothing in the app needs these to work, and a
              wall between someone and their files is how sign-ups are lost. */}
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Later
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!countryCode}>
            Save and continue
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
