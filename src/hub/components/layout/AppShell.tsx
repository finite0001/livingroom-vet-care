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
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:text-sm focus:font-medium">
        Skip to main content
      </a>
      <DesktopSidebar collapsed={navHidden} />
      <div className="flex flex-1 flex-col">
        <UserHeader navHidden={navHidden} onToggleNav={() => setNavHidden((v) => !v)} />
        <main
          id="main-content"
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
