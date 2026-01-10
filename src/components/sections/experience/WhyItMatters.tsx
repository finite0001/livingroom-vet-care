import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Smile, Clock, TrendingDown } from "lucide-react";

const comparisons = [
  {
    traditional: {
      icon: AlertTriangle,
      title: "Traditional Waiting Room",
      points: [
        "15-30 minutes in crowded lobby",
        "Dogs barking, cats hissing",
        "Your pet's anxiety building",
        "Stress before exam even starts",
      ],
    },
    livingRoom: {
      icon: Smile,
      title: "The Living Room Experience",
      points: [
        "Zero waiting room time",
        "Complete privacy and quiet",
        "Your pet stays calm",
        "Relaxed from start to finish",
      ],
    },
  },
];

const stats = [
  {
    icon: Clock,
    value: "0",
    unit: "min",
    label: "Waiting Room Time",
  },
  {
    icon: TrendingDown,
    value: "100%",
    unit: "",
    label: "Less Pet-to-Pet Stress",
  },
  {
    icon: Smile,
    value: "93%",
    unit: "",
    label: "of Pets Show Reduced Anxiety",
  },
];

const WhyItMatters = () => {
  return (
    <section className="py-24 bg-cream">
      <div className="container">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-primary font-medium mb-3">Why It Matters</p>
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            The Difference is Real
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Studies show that waiting room stress can affect exam results and your pet's 
            long-term relationship with veterinary care.
          </p>
        </div>

        {/* Comparison Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-20">
          {/* Traditional */}
          <Card variant="outline" className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-destructive/20 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-destructive" />
                </div>
                <h3 className="font-heading text-xl font-semibold text-foreground">
                  Traditional Waiting Room
                </h3>
              </div>
              <ul className="space-y-4">
                {comparisons[0].traditional.points.map((point, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-destructive/50 shrink-0 mt-2" />
                    <span className="text-muted-foreground">{point}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Living Room */}
          <Card variant="warm" className="border-sage/30">
            <CardContent className="p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-warm flex items-center justify-center">
                  <Smile className="h-6 w-6 text-primary-foreground" />
                </div>
                <h3 className="font-heading text-xl font-semibold text-foreground">
                  The Living Room Experience
                </h3>
              </div>
              <ul className="space-y-4">
                {comparisons[0].livingRoom.points.map((point, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-sage shrink-0 mt-2" />
                    <span className="text-foreground font-medium">{point}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="text-center p-8 rounded-2xl bg-cream-light shadow-soft"
            >
              <div className="w-14 h-14 rounded-2xl bg-sage/30 flex items-center justify-center mx-auto mb-4">
                <stat.icon className="h-7 w-7 text-sage-dark" />
              </div>
              <div className="flex items-baseline justify-center gap-1 mb-2">
                <span className="font-heading text-5xl font-bold text-foreground">
                  {stat.value}
                </span>
                {stat.unit && (
                  <span className="text-2xl font-heading font-semibold text-muted-foreground">
                    {stat.unit}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground font-medium">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default WhyItMatters;
