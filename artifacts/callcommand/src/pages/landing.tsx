import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, Activity, Zap, Shield, FileText } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="h-6 w-6 text-primary" />
            <span className="font-bold tracking-tight text-lg">CallCommand AI</span>
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              HQ Login
            </Link>
            <Link href="/sign-up" className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2">
              Enlist Now
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 md:pt-40 md:pb-28 px-6 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/15 via-background to-background -z-10 blur-3xl"></div>
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter mb-6">
            Command Your Calls.<br />
            <span className="text-primary">Extract the Intel.</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            The tactical mission console for sales and support teams. Turn unstructured voice recordings into structured data, instantly.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/sign-up" className="w-full sm:w-auto inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-12 px-8">
              Start Mission
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="/sign-in" className="w-full sm:w-auto inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-12 px-8">
              View Demo
            </Link>
          </div>
        </div>
        <div className="mt-20 max-w-5xl mx-auto rounded-xl border border-border bg-card p-2 shadow-2xl relative">
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent z-10 h-full pointer-events-none bottom-0 translate-y-1/2" />
          <img src="/hero-dashboard.png" alt="CallCommand AI Dashboard" className="rounded-lg w-full h-auto border border-border/50" />
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-secondary/30 px-6 border-y border-border/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Tactical Advantages</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Equip your team with the intelligence they need to execute immediately after every engagement.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card border border-border p-6 rounded-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 transition-opacity group-hover:bg-primary/20"></div>
              <Activity className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Automated Transcripts</h3>
              <p className="text-muted-foreground text-sm">Perfectly accurate speech-to-text processing separates speakers and structures the narrative.</p>
            </div>
            <div className="bg-card border border-border p-6 rounded-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 transition-opacity group-hover:bg-primary/20"></div>
              <Zap className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Action Extraction</h3>
              <p className="text-muted-foreground text-sm">Our AI pulls out exact deliverables, deadlines, and owners so nothing slips through the cracks.</p>
            </div>
            <div className="bg-card border border-border p-6 rounded-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 transition-opacity group-hover:bg-primary/20"></div>
              <Shield className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Sentiment Radar</h3>
              <p className="text-muted-foreground text-sm">Know exactly how the caller feels. Detect frustration, urgency, or satisfaction immediately.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Intel Section */}
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Turn raw noise into structured intelligence.</h2>
            <p className="text-muted-foreground mb-8 text-lg">
              Stop re-listening to hours of calls just to find one piece of information. CallCommand AI synthesizes the exact data points you need to close the deal or solve the ticket.
            </p>
            <ul className="space-y-4">
              {[
                "Instant summaries & key points",
                "Automated follow-up drafting",
                "CRM-ready JSON payloads",
                "Priority and intent scoring"
              ].map((item, i) => (
                <li key={i} className="flex items-center space-x-3 text-sm font-medium">
                  <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <img src="/audio-wave.png" alt="Audio Analysis" className="rounded-xl border border-border shadow-2xl" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 relative overflow-hidden border-t border-border/50">
        <div className="absolute inset-0 bg-primary/5 -z-10"></div>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Ready for deployment?</h2>
          <p className="text-xl text-muted-foreground mb-10">
            Join the operators who process thousands of calls per day with CallCommand AI.
          </p>
          <Link href="/sign-up" className="inline-flex items-center justify-center rounded-md text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-14 px-10">
            Enlist Now
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border bg-background text-center text-sm text-muted-foreground">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center space-x-2 mb-4 md:mb-0">
            <Activity className="h-4 w-4" />
            <span className="font-semibold text-foreground">CallCommand AI</span>
          </div>
          <p>© {new Date().getFullYear()} CallCommand AI. All systems operational.</p>
        </div>
      </footer>
    </div>
  );
}
