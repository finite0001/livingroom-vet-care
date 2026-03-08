import { Button } from "@/components/ui/button";
import { Play, Expand } from "lucide-react";
import ScrollReveal, { StaggerContainer, StaggerItem } from "@/components/ScrollReveal";
import heroImage from "@/assets/hero-living-room.jpg";
import catRoomImage from "@/assets/experience-cat-room.jpg";
import vetFloorImage from "@/assets/experience-vet-floor.jpg";

const tourImages = [
  { src: heroImage, alt: "Living room exam space with comfortable sofa", label: "Dog Exam Room" },
  { src: catRoomImage, alt: "Cat-friendly exam room with window seat", label: "Cat Suite" },
  { src: vetFloorImage, alt: "Veterinarian providing gentle care", label: "Care in Action" },
];

const VirtualTour = () => {
  return (
    <section id="virtual-tour" className="py-24 bg-background">
      <div className="container">
        <ScrollReveal className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-primary font-medium mb-3">Virtual Tour</p>
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            See Our Living Room Spaces
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Take a peek inside our exam rooms—designed to feel like an extension 
            of your own home.
          </p>
        </ScrollReveal>

        <ScrollReveal variant="scaleUp" className="relative mb-8 group cursor-pointer">
          <div className="absolute -inset-2 bg-gradient-warm rounded-3xl opacity-20 blur-xl group-hover:opacity-30 transition-opacity" />
          <div className="relative aspect-video rounded-2xl overflow-hidden shadow-elevated">
            <img
              src={heroImage}
              alt="Virtual tour of our living room veterinary space"
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-charcoal/30 flex items-center justify-center group-hover:bg-charcoal/40 transition-colors">
              <div className="w-20 h-20 rounded-full bg-cream-light/90 flex items-center justify-center shadow-elevated group-hover:scale-110 transition-transform">
                <Play className="h-8 w-8 text-primary ml-1" fill="currentColor" />
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-charcoal/80 to-transparent">
              <p className="text-cream-light font-heading font-semibold text-lg">
                Take a 360° Tour of Our Space
              </p>
              <p className="text-cream-light/70 text-sm">2 minute virtual walkthrough</p>
            </div>
          </div>
        </ScrollReveal>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {tourImages.map((image, index) => (
            <StaggerItem key={index} variant="scaleUp">
              <div className="relative group cursor-pointer rounded-xl overflow-hidden shadow-card hover:shadow-warm transition-shadow">
                <img
                  src={image.src}
                  alt={image.alt}
                  className="w-full aspect-[4/3] object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-charcoal/0 group-hover:bg-charcoal/30 transition-colors flex items-center justify-center">
                  <Expand className="h-8 w-8 text-cream-light opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-charcoal/70 to-transparent">
                  <p className="text-cream-light font-medium text-sm">{image.label}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        <ScrollReveal variant="fade" delay={0.2} className="text-center mt-12">
          <p className="text-muted-foreground mb-4">Want to see it in person?</p>
          <Button variant="default" size="lg">Schedule a Tour</Button>
        </ScrollReveal>
      </div>
    </section>
  );
};

export default VirtualTour;
