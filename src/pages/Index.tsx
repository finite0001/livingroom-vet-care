import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import HeroSection from "@/components/sections/HeroSection";
import WhyDifferentSection from "@/components/sections/WhyDifferentSection";
import ServicesSection from "@/components/sections/ServicesSection";
import CTASection from "@/components/sections/CTASection";
import { usePageTitle } from "@/hooks/use-page-title";

const Index = () => {
  usePageTitle("Fear-Free Veterinary Care in Boulder");
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main-content" className="flex-grow">
        <HeroSection />
        <WhyDifferentSection />
        <ServicesSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
