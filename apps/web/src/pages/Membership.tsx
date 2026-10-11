import { Page } from "../app/Shell";
import { Notice } from "../ui";
import "./Membership.css";

/** Free tier contents from FR-073; planned premium cosmetics from FR-074. No prices, no purchase. */
const FREE = [
  "Essential flight selection",
  "Validated flight durations",
  "Countdown and flight progress",
  "Basic route inspection",
  "Focus and break tracking",
  "Essential announcements",
  "Basic cabin environment",
  "Passport and travel history",
  "Standard passport colours",
  "Community flight viewing, subject to availability",
  "Core privacy and accessibility controls",
];

const PREMIUM = [
  "Expanded aircraft interiors",
  "Premium cosmetic themes",
  "Additional cabin environments",
  "Enhanced scenery",
  "Exclusive lounge visuals",
  "Special audio packs",
  "Decorative passport finishes",
  "Extended cosmetic customisation",
];

export default function Membership() {
  return (
    <Page title="Membership" lead="The free tier is the whole flight-study experience. Premium, when it arrives, only adds cosmetics.">
      <Notice>Premium is not on sale yet. Nothing here is required to fly.</Notice>
      <dl className="tiers">
        <div className="tier">
          <dt>
            <span className="tier-name">Free</span>
            <span className="small muted">Everything you need to study on a flight</span>
          </dt>
          <dd>
            <ul className="tier-list">
              {FREE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="tier">
          <dt>
            <span className="tier-name">Premium (coming later)</span>
            <span className="small muted">Cosmetics only; never study hours or records</span>
          </dt>
          <dd>
            <ul className="tier-list">
              {PREMIUM.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      <p className="small muted">Premium improves immersion without making free productivity features unreliable or unusable. Purchases never grant study hours or completed flights.</p>
    </Page>
  );
}
