import { Suspense, lazy, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import { SessionProvider, useSession } from "../lib/session";
import { Skeleton } from "../ui/Board";
import { ToastProvider } from "../ui/Toast";
import { Shell } from "./Shell";

const Dashboard = lazy(() => import("../pages/Dashboard"));
const Search = lazy(() => import("../pages/Search"));
const Random = lazy(() => import("../pages/Random"));
const Book = lazy(() => import("../pages/Book"));
const Bookings = lazy(() => import("../pages/Bookings"));
const Pass = lazy(() => import("../pages/Pass"));
const Boarding = lazy(() => import("../pages/Boarding"));
const Flight = lazy(() => import("../pages/Flight"));
const Arrival = lazy(() => import("../pages/Arrival"));
const Community = lazy(() => import("../pages/Community"));
const Globe = lazy(() => import("../pages/Globe"));
const Airports = lazy(() => import("../pages/Airports"));
const Passport = lazy(() => import("../pages/Passport"));
const Hangar = lazy(() => import("../pages/Hangar"));
const Rewards = lazy(() => import("../pages/Rewards"));
const History = lazy(() => import("../pages/History"));
const Profile = lazy(() => import("../pages/Profile"));
const Membership = lazy(() => import("../pages/Membership"));
const Settings = lazy(() => import("../pages/Settings"));
const Auth = lazy(() => import("../pages/Auth"));
const NotFound = lazy(() => import("../pages/NotFound"));

function Ready({ children }: { children: ReactNode }) {
  const { ready } = useSession();
  if (!ready) {
    return (
      <div style={{ padding: "2rem" }}>
        <Skeleton lines={4} />
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <Shell>
          <Ready>
            <Suspense fallback={<Skeleton lines={5} />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/fly/search" element={<Search />} />
                <Route path="/fly/random" element={<Random />} />
                <Route path="/fly/book/:snapshotId" element={<Book />} />
                <Route path="/fly/bookings" element={<Bookings />} />
                <Route path="/fly/pass/:bookingId" element={<Pass />} />
                <Route path="/fly/boarding/:bookingId" element={<Boarding />} />
                <Route path="/fly/active" element={<Flight />} />
                <Route path="/fly/arrival" element={<Arrival />} />
                <Route path="/explore/community" element={<Community />} />
                <Route path="/explore/globe" element={<Globe />} />
                <Route path="/explore/airports" element={<Airports />} />
                <Route path="/collection/passport" element={<Passport />} />
                <Route path="/collection/hangar" element={<Hangar />} />
                <Route path="/collection/rewards" element={<Rewards />} />
                <Route path="/collection/history" element={<History />} />
                <Route path="/account/profile" element={<Profile />} />
                <Route path="/account/membership" element={<Membership />} />
                <Route path="/account/settings" element={<Settings />} />
                <Route path="/account/sign-in" element={<Auth />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </Ready>
        </Shell>
      </ToastProvider>
    </SessionProvider>
  );
}
