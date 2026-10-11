import type { IconName } from "../ui/Icon";

/** Navigation groups from plan.md §19. */
export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown in the mobile tab bar (one per group). */
  primary?: boolean;
}

export interface NavGroup {
  label: "Fly" | "Explore" | "Collection" | "Account";
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Fly",
    items: [
      { to: "/", label: "Dashboard", icon: "plane", primary: true },
      { to: "/fly/search", label: "Book flight", icon: "search" },
      { to: "/fly/bookings", label: "My bookings", icon: "ticket" },
      { to: "/fly/random", label: "Random flight", icon: "dice" },
      { to: "/fly/active", label: "Active flight", icon: "window" },
    ],
  },
  {
    label: "Explore",
    items: [
      { to: "/explore/community", label: "Community flights", icon: "community", primary: true },
      { to: "/explore/globe", label: "World globe", icon: "globe" },
      { to: "/explore/airports", label: "Airport directory", icon: "map" },
    ],
  },
  {
    label: "Collection",
    items: [
      { to: "/collection/passport", label: "Passport", icon: "passport", primary: true },
      { to: "/collection/hangar", label: "Aircraft hangar", icon: "hangar" },
      { to: "/collection/rewards", label: "Achievements", icon: "trophy" },
      { to: "/collection/history", label: "Flight history", icon: "clock" },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/account/profile", label: "Profile", icon: "person", primary: true },
      { to: "/account/membership", label: "Membership", icon: "stamp" },
      { to: "/account/settings", label: "Settings", icon: "settings" },
    ],
  },
];
