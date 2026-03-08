import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ExperienceHero from "@/components/sections/experience/ExperienceHero";
import HowItWorks from "@/components/sections/experience/HowItWorks";
import WhyItMatters from "@/components/sections/experience/WhyItMatters";
import VirtualTour from "@/components/sections/experience/VirtualTour";
import CTASection from "@/components/sections/CTASection";
import { usePageTitle } from "@/hooks/use-page-title";

const Experience = () => {
  usePageTitle("The Experience");
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        <ExperienceHero />
        <HowItWorks />
        <WhyItMatters />
        <VirtualTour />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
};

export default Experience;
