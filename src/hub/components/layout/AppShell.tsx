import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { DesktopSidebar } from "./DesktopSidebar";
import { UserHeader } from "./UserHeader";
import { BottomTabBar } from "./BottomTabBar";
import { ErrorBoundary } from "../ErrorBoundary";

export function AppShell() {
  const location = useLocation();
  const [navHidden, setNavHidden] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <DesktopSidebar collapsed={navHidden} />
      <div className="flex flex-1 flex-col">
        <UserHeader navHidden={navHidden} onToggleNav={() => setNavHidden((v) => !v)} />
        <main
          key={location.pathname}
          className={`mx-auto w-full max-w-screen-xl flex-1 animate-fade-in ${navHidden ? "pb-0" : "pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0"}`}
        >
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
        {!navHidden && (
          <div className="md:hidden">
            <BottomTabBar />
          </div>
        )}
      </div>
    </div>
  );
}
