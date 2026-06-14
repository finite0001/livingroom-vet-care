import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop";
import { MarketingErrorBoundary } from "./components/MarketingErrorBoundary";
import Index from "./pages/Index";
import Experience from "./pages/Experience";
import Services from "./pages/Services";
import WellnessCare from "./pages/services/WellnessCare";
import SeniorCare from "./pages/services/SeniorCare";
import LaserTherapy from "./pages/services/LaserTherapy";
import Surgery from "./pages/services/Surgery";
import Diagnostics from "./pages/services/Diagnostics";
import IllnessCare from "./pages/services/IllnessCare";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Vaccinations from "./pages/services/Vaccinations";
import NotFound from "./pages/NotFound";

// Hub imports
import { AuthProvider } from "@/hub/contexts/AuthContext";
import { ProtectedRoute } from "@/hub/components/layout/ProtectedRoute";
import { AppShell } from "@/hub/components/layout/AppShell";

const HubLoginPage = lazy(() => import("@/hub/pages/LoginPage"));
const HubHomePage = lazy(() => import("@/hub/pages/HubHomePage"));
const PlaceholderPage = lazy(() => import("@/hub/pages/PlaceholderPage"));
const ConversationsPage = lazy(() => import("@/hub/pages/ConversationsPage"));
const ConversationDetailPage = lazy(() => import("@/hub/pages/ConversationDetailPage"));
const ClientsPage = lazy(() => import("@/hub/pages/ClientsPage"));
const ClientProfilePage = lazy(() => import("@/hub/pages/ClientProfilePage"));
const AdminStaffPage = lazy(() => import("@/hub/pages/AdminStaffPage"));
const AdminDashboardPage = lazy(() => import("@/hub/pages/AdminDashboardPage"));
const SettingsPage = lazy(() => import("@/hub/pages/SettingsPage"));
const TimeClockPage = lazy(() => import("@/hub/pages/TimeClockPage"));
const TemplatesPage = lazy(() => import("@/hub/pages/TemplatesPage"));

function HubLoader() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTop />
          <Suspense fallback={<HubLoader />}>
            <Routes>
              {/* Marketing site routes */}
              <Route path="/" element={<MarketingErrorBoundary><Index /></MarketingErrorBoundary>} />
              <Route path="/experience" element={<MarketingErrorBoundary><Experience /></MarketingErrorBoundary>} />
              <Route path="/services" element={<MarketingErrorBoundary><Services /></MarketingErrorBoundary>} />
              <Route path="/services/wellness" element={<MarketingErrorBoundary><WellnessCare /></MarketingErrorBoundary>} />
              <Route path="/services/senior-care" element={<MarketingErrorBoundary><SeniorCare /></MarketingErrorBoundary>} />
              <Route path="/services/laser-therapy" element={<MarketingErrorBoundary><LaserTherapy /></MarketingErrorBoundary>} />
              <Route path="/services/surgery" element={<MarketingErrorBoundary><Surgery /></MarketingErrorBoundary>} />
              <Route path="/services/diagnostics" element={<MarketingErrorBoundary><Diagnostics /></MarketingErrorBoundary>} />
              <Route path="/services/illness-care" element={<MarketingErrorBoundary><IllnessCare /></MarketingErrorBoundary>} />
              <Route path="/services/vaccinations" element={<MarketingErrorBoundary><Vaccinations /></MarketingErrorBoundary>} />
              <Route path="/about" element={<MarketingErrorBoundary><About /></MarketingErrorBoundary>} />
              <Route path="/contact" element={<MarketingErrorBoundary><Contact /></MarketingErrorBoundary>} />

              {/* Hub public routes */}
              <Route path="/hub/login" element={<HubLoginPage />} />

              {/* Hub protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppShell />}>
                  <Route path="/hub" element={<HubHomePage />} />
                  <Route path="/hub/chats" element={<ConversationsPage />} />
                  <Route path="/hub/conversation/:id" element={<ConversationDetailPage />} />
                  <Route path="/hub/clients" element={<ClientsPage />} />
                  <Route path="/hub/client/:id" element={<ClientProfilePage />} />
                  <Route path="/hub/tickets" element={<PlaceholderPage />} />
                  <Route path="/hub/ticket/:id" element={<PlaceholderPage />} />
                  <Route path="/hub/call" element={<PlaceholderPage />} />
                  <Route path="/hub/voicemails" element={<PlaceholderPage />} />
                  <Route path="/hub/settings" element={<SettingsPage />} />
                  <Route path="/hub/time" element={<TimeClockPage />} />
                  <Route path="/hub/tools/templates" element={<TemplatesPage />} />
                  <Route path="/hub/tools/campaigns" element={<PlaceholderPage />} />
                  <Route path="/hub/tools/surveys" element={<PlaceholderPage />} />
                  <Route path="/hub/tools/alerts" element={<PlaceholderPage />} />
                  <Route path="/hub/tools/refills" element={<PlaceholderPage />} />
                  <Route path="/hub/tools/ezyvet" element={<PlaceholderPage />} />
                </Route>
              </Route>

              {/* Hub admin routes */}
              <Route element={<ProtectedRoute requiredRole="ADMIN" />}>
                <Route element={<AppShell />}>
                  <Route path="/hub/admin" element={<AdminDashboardPage />} />
                  <Route path="/hub/admin/import" element={<PlaceholderPage />} />
                  <Route path="/hub/admin/staff" element={<AdminStaffPage />} />
                </Route>
              </Route>


              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
