import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop";
import Index from "./pages/Index";
import Experience from "./pages/Experience";
import Services from "./pages/Services";
import WellnessCare from "./pages/services/WellnessCare";
import SeniorCare from "./pages/services/SeniorCare";
import LaserTherapy from "./pages/services/LaserTherapy";
import Surgery from "./pages/services/Surgery";
import Diagnostics from "./pages/services/Diagnostics";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Vaccinations from "./pages/services/Vaccinations";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/experience" element={<Experience />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/wellness" element={<WellnessCare />} />
          <Route path="/services/senior-care" element={<SeniorCare />} />
          <Route path="/services/laser-therapy" element={<LaserTherapy />} />
          <Route path="/services/surgery" element={<Surgery />} />
          <Route path="/services/diagnostics" element={<Diagnostics />} />
          <Route path="/services/vaccinations" element={<Vaccinations />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
