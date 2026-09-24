import { lazy, Suspense } from "react";
import "./marketing-fonts.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Outlet, Route } from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop";
import { MarketingErrorBoundary } from "./components/MarketingErrorBoundary";
import NotFound from "./pages/NotFound";

// Marketing pages are lazy so the marketing site stays out of the hub's main
// bundle (matters on housecall mobile data). Each is its own code-split chunk.
const Index = lazy(() => import("./pages/Index"));
const Experience = lazy(() => import("./pages/Experience"));
const Services = lazy(() => import("./pages/Services"));
const WellnessCare = lazy(() => import("./pages/services/WellnessCare"));
const SeniorCare = lazy(() => import("./pages/services/SeniorCare"));
const LaserTherapy = lazy(() => import("./pages/services/LaserTherapy"));
const Surgery = lazy(() => import("./pages/services/Surgery"));
const Diagnostics = lazy(() => import("./pages/services/Diagnostics"));
const IllnessCare = lazy(() => import("./pages/services/IllnessCare"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Vaccinations = lazy(() => import("./pages/services/Vaccinations"));

// Hub imports
import { AuthProvider } from "@/hub/contexts/AuthContext";
import { ProtectedRoute } from "@/hub/components/layout/ProtectedRoute";
import { AppShell } from "@/hub/components/layout/AppShell";

const HubLoginPage = lazy(() => import("@/hub/pages/LoginPage"));
const ResetPasswordPage = lazy(() => import("@/hub/pages/ResetPasswordPage"));
const UnavailableToolPage = lazy(() => import("@/hub/pages/UnavailableToolPage"));
const HubHomePage = lazy(() => import("@/hub/pages/HubHomePage"));
const HubNotFoundPage = lazy(() => import("@/hub/pages/HubNotFoundPage"));
const WebsiteInquiriesPage = lazy(() => import("@/hub/features/inquiries/WebsiteInquiriesPage"));
const ProcessingQueuePage = lazy(() => import("@/hub/features/inbound-review/ProcessingQueuePage"));
const InboxReviewPage = lazy(() => import("@/hub/features/inbound-review/InboxReviewPage"));
const ConversationsPage = lazy(() => import("@/hub/pages/ConversationsPage"));
const ConversationDetailPage = lazy(() => import("@/hub/pages/ConversationDetailPage"));
const ContactSubmissionsPage = lazy(() => import("@/hub/pages/ContactSubmissionsPage"));
const AppointmentsPage = lazy(() => import("@/hub/pages/AppointmentsPage"));
const DeliveriesPage = lazy(() => import("@/hub/pages/DeliveriesPage"));
const ClientsPage = lazy(() => import("@/hub/pages/ClientsPage"));
const EzyVetImportPage = lazy(() => import("./hub/features/imports/EzyVetImportPage").then(module => ({ default: module.EzyVetImportPage })));
const InventoryPage = lazy(() => import("./hub/features/inventory/InventoryPage").then(module => ({ default: module.InventoryPage })));
const OutboxRetryPage = lazy(() => import("@/hub/features/outbox-retry/OutboxRetryPage"));
const OperationsPage = lazy(() => import("@/hub/features/operations/OperationsPage"));
const CareRemindersPage = lazy(() => import("@/hub/features/care-reminders/CareRemindersPage").then(module => ({ default: module.CareRemindersPage })));
const SchedulePage = lazy(() => import("./hub/features/scheduling/SchedulePage"));
const PatientPage = lazy(() => import("@/hub/features/patients/PatientPage"));
const ClientProfilePage = lazy(() => import("@/hub/pages/ClientProfilePage"));
const AdminStaffPage = lazy(() => import("@/hub/pages/AdminStaffPage"));
const AdminDashboardPage = lazy(() => import("@/hub/pages/AdminDashboardPage"));
const SettingsPage = lazy(() => import("@/hub/pages/SettingsPage"));
const TimeClockPage = lazy(() => import("@/hub/pages/TimeClockPage"));
const TemplatesPage = lazy(() => import("@/hub/pages/TemplatesPage"));
const MyTimePage = lazy(() => import("@/hub/pages/MyTimePage"));
const TicketsPage = lazy(() => import("@/hub/pages/TicketsPage"));
const TicketDetailPage = lazy(() => import("@/hub/pages/TicketDetailPage"));
const RefillsPage = lazy(() => import("@/hub/pages/RefillsPage"));
const PatientsPage = lazy(() => import("@/hub/pages/PatientsPage"));

function HubLoader() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

const queryClient = new QueryClient();

// Data-router navigation supports the clinical editor's unsaved-change blocker,
// including back/forward navigation, while retaining the existing route tree.
const router = createBrowserRouter(createRoutesFromElements(
  <Route element={<><ScrollToTop /><Suspense fallback={<HubLoader />}><Outlet /></Suspense></>}>
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
              <Route path="/privacy" element={<MarketingErrorBoundary><Privacy /></MarketingErrorBoundary>} />
              <Route path="/terms" element={<MarketingErrorBoundary><Terms /></MarketingErrorBoundary>} />

              {/* Hub public routes */}
              <Route path="/hub/login" element={<HubLoginPage />} />
              <Route path="/hub/reset-password" element={<ResetPasswordPage />} />

              {/* Hub protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppShell />}>
                  <Route path="/hub" element={<HubHomePage />} />
                  <Route path="/hub/inquiries" element={<WebsiteInquiriesPage />} />
                  <Route path="/hub/contact-submissions" element={<ContactSubmissionsPage />} />
                  <Route path="/hub/chats" element={<ConversationsPage />} />
                  <Route path="/hub/inbox/review" element={<InboxReviewPage />} />
                  <Route path="/hub/inbox/processing" element={<ProcessingQueuePage />} />
                  <Route path="/hub/conversation/:id" element={<ConversationDetailPage />} />
                  <Route path="/hub/schedule" element={<SchedulePage />} />
                  <Route path="/hub/appointments" element={<AppointmentsPage />} />
                  <Route path="/hub/deliveries" element={<DeliveriesPage />} />
                  <Route path="/hub/inventory" element={<InventoryPage />} />
                  <Route path="/hub/clients" element={<ClientsPage />} />
                  <Route path="/hub/patients" element={<PatientsPage />} />
                  <Route path="/hub/client/:id" element={<ClientProfilePage />} />
                  <Route path="/hub/patient/:id" element={<PatientPage />} />
                  <Route path="/hub/tickets" element={<TicketsPage />} />
                  <Route path="/hub/ticket/:id" element={<TicketDetailPage />} />
                  <Route path="/hub/call" element={<UnavailableToolPage />} />
                  <Route path="/hub/voicemails" element={<UnavailableToolPage />} />
                  <Route path="/hub/settings" element={<SettingsPage />} />
                  <Route path="/hub/time" element={<TimeClockPage />} />
                  <Route path="/hub/timesheet" element={<MyTimePage />} />
                  <Route path="/hub/tools/care-reminders" element={<CareRemindersPage />} />
                  <Route path="/hub/tools/templates" element={<TemplatesPage />} />
                  <Route path="/hub/tools/campaigns" element={<UnavailableToolPage />} />
                  <Route path="/hub/tools/surveys" element={<UnavailableToolPage />} />
                  <Route path="/hub/tools/alerts" element={<UnavailableToolPage />} />
                  <Route path="/hub/tools/refills" element={<RefillsPage />} />
                  {/* Unknown hub URL: keep the staff session and the shell, so a stale
                      bookmark never lands on the public marketing 404. */}
                  <Route path="/hub/*" element={<HubNotFoundPage />} />
                </Route>
              </Route>

              {/* Hub admin routes */}
              <Route element={<ProtectedRoute requiredRole="ADMIN" />}>
                <Route element={<AppShell />}>
                  <Route path="/hub/tools/ezyvet" element={<EzyVetImportPage />} />
                  <Route path="/hub/admin" element={<AdminDashboardPage />} />
                  <Route path="/hub/admin/operations" element={<OperationsPage />} />
                  <Route path="/hub/admin/outbox/:id?" element={<OutboxRetryPage />} />
                  <Route path="/hub/admin/import" element={<UnavailableToolPage />} />
                  <Route path="/hub/admin/staff" element={<AdminStaffPage />} />
                </Route>
              </Route>


              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
  </Route>
));

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner position="top-right" closeButton />
        <RouterProvider router={router} />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
