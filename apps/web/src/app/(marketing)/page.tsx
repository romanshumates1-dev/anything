import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  CheckCircle,
  Bot,
  Shield,
  Zap,
  BarChart3,
  MessageSquare,
  Users,
  FileText,
  ArrowRight,
  Star,
  Sparkles,
} from "lucide-react";
import { auth } from "@/lib/auth";
import {
  RecentlyJoinedAvatars,
  BetaPricingBanner,
  IndustryFactsSection,
  ROICalculator,
  GuaranteeBadgeRow,
  SecurityBadges,
  ScarcityBadge,
  LiveSocialProof,
  LimitedTimeOffer,
} from "@/components/marketing";

// Marketing landing owns "/". Guests see this page; authenticated users are
// sent to the SaaS app at /dashboard.
export default async function LandingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");

  return (
    <div className="bg-[#0F172A]">
      {/* Signup Notification Popup */}
      <LiveSocialProof variant="popup" fetchFromApi />

      {/* Ethical Urgency Banner - Real beta pricing, not fake scarcity */}
      <div className="bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white py-3 px-4 text-center text-sm">
        <span className="font-semibold">Early Adopter Pricing: 50% OFF</span>
        <span className="mx-3 opacity-50">|</span>
        <span className="opacity-90">Lock in this rate before general launch</span>
        <span className="ml-2 inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-xs">
          <Users className="h-3 w-3" /> Join early adopters
        </span>
      </div>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-[#3B82F6]/10 blur-3xl" />
          <div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-[#8B5CF6]/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-4 py-1.5 text-sm font-medium text-[#3B82F6]">
                <Sparkles className="h-4 w-4" />
                AI That Finds Deals and Closes Them
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl leading-[1.1]">
                Find properties, make offers,{" "}
                <span className="bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] bg-clip-text text-transparent">
                  close deals faster
                </span>
              </h1>
              <p className="text-lg text-slate-400 max-w-xl leading-relaxed">
                DealFlow AI helps you buy properties below market value and sell them
                to investors for a profit — with AI handling the outreach, follow-ups,
                and negotiations so you can focus on closing.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/account/signup"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-6 py-3.5 text-base font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
                >
                  Start Free Trial
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/features"
                  className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-6 py-3.5 text-base font-medium text-white hover:bg-white/10 transition-colors"
                >
                  See Features
                </Link>
              </div>

              {/* Scarcity Badge near CTA */}
              <div className="pt-2">
                <ScarcityBadge
                  spotsRemaining={200}
                  fetchFromApi
                  size="md"
                  animated
                />
              </div>

              {/* Social Proof Badges */}
              <div className="flex flex-wrap items-center gap-6 pt-4">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <span>14-day free trial</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <span>Cancel anytime</span>
                </div>
              </div>

              {/* Recently Joined Social Proof */}
              <div className="pt-2">
                <RecentlyJoinedAvatars />
              </div>
            </div>

            {/* Hero Visual - AI Chat Demo */}
            <div className="hidden lg:block">
              <div className="relative">
                {/* Glow effect */}
                <div className="absolute -inset-4 bg-gradient-to-r from-[#3B82F6]/20 to-[#8B5CF6]/20 rounded-3xl blur-xl" />

                <div className="relative rounded-2xl border border-white/10 bg-[#1E293B]/80 backdrop-blur-sm p-6 shadow-2xl">
                  <div className="space-y-4">
                    {/* Chat Header */}
                    <div className="flex items-center justify-between pb-4 border-b border-white/10">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
                          <Bot className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">DealFlow AI</p>
                          <p className="text-xs text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Active on 3 leads
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-slate-500">Just now</span>
                    </div>

                    {/* Incoming Message */}
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-300">JS</div>
                      <div className="flex-1">
                        <p className="text-xs text-slate-500 mb-1">John Smith - 123 Main St</p>
                        <div className="rounded-lg bg-slate-700/50 p-3">
                          <p className="text-sm text-slate-300">
                            "The offer on 123 Main St looks great. Let's move forward with the paperwork."
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* AI Status */}
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-emerald-400">AI responding to lead...</span>
                    </div>

                    {/* Approval Alert */}
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                      <div className="flex items-start gap-3">
                        <Shield className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-amber-400">
                            Approval Required
                          </p>
                          <p className="text-xs text-amber-400/70 mt-1">
                            AI negotiated range $180K-$220K for 123 Main St. Tap to approve.
                          </p>
                          <div className="flex gap-2 mt-3">
                            <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-500 text-white">
                              Approve
                            </button>
                            <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-600 text-slate-300">
                              Review
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live Social Proof Banner */}
      <LiveSocialProof
        variant="banner"
        fetchFromApi
      />

      {/* Platform Goals / Vision */}
      <section className="border-y border-white/10 bg-[#0A0F1A]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="text-center md:text-left">
              <p className="text-sm text-slate-500 uppercase tracking-wider font-medium">Our 2026 Goals</p>
              <p className="text-2xl font-bold text-white mt-1">Building the Future of Wholesaling</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
              <div className="text-center">
                <p className="text-3xl font-bold text-white">$45M+</p>
                <p className="text-sm text-slate-500 mt-1">Target deal volume*</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-white">2,500+</p>
                <p className="text-sm text-slate-500 mt-1">Deal goal*</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-white">5/5</p>
                <p className="text-sm text-slate-500 mt-1">Our standard</p>
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-slate-600 mt-4">*Projected goals based on platform capacity and market analysis. Actual results will vary.</p>
        </div>
      </section>

      {/* Problem/Solution */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">The Problem</span>
              <h2 className="mt-4 text-3xl font-bold text-white">
                Manual outreach is killing your deals
              </h2>
              <ul className="mt-8 space-y-4">
                {[
                  "Spending hours texting leads who never respond",
                  "Missing hot leads because you can't respond fast enough",
                  "Losing deals to competitors with faster follow-up",
                  "Struggling to track conversations across dozens of leads",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-red-400 text-sm">x</span>
                    </div>
                    <span className="text-slate-400">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <span className="text-sm font-medium text-emerald-400 uppercase tracking-wider">The Solution</span>
              <h2 className="mt-4 text-3xl font-bold text-white">
                Let AI handle the conversation
              </h2>
              <ul className="mt-8 space-y-4">
                {[
                  "AI sends personalized messages 24/7 while you sleep",
                  "Instant responses keep leads engaged and interested",
                  "Smart qualification filters out tire-kickers automatically",
                  "One dashboard to manage all conversations at scale",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    </div>
                    <span className="text-slate-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Industry Facts - Why Speed Matters */}
      <section className="py-20 bg-[#0A0F1A]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <IndustryFactsSection
            title="Why Speed Matters in Real Estate"
            subtitle="Industry research shows that response time is the #1 factor in lead conversion"
          />
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 bg-[#0F172A]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">How It Works</span>
            <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
              Three steps from lead to close
            </h2>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
              AI handles the busywork so you can focus on closing deals.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Add Properties",
                desc: "Upload a list of properties you want to buy, or use our lead finder to discover off-market opportunities in your area.",
                icon: Users,
                color: "from-blue-500 to-cyan-500",
              },
              {
                step: "02",
                title: "AI Reaches Out",
                desc: "DealFlow contacts property owners by text and email, answers their questions, and negotiates price ranges — 24/7, even while you sleep.",
                icon: Bot,
                color: "from-purple-500 to-pink-500",
              },
              {
                step: "03",
                title: "You Close the Deal",
                desc: "When an owner is ready to sell, you get a notification. Review the terms, approve with one tap, and close your deal.",
                icon: CheckCircle,
                color: "from-emerald-500 to-teal-500",
              },
            ].map((item) => (
              <div key={item.step} className="relative group">
                <div className="rounded-2xl border border-white/10 bg-[#1E293B]/50 p-8 h-full transition-all hover:border-white/20 hover:bg-[#1E293B]/80">
                  <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br ${item.color} mb-6`}>
                    <item.icon className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-sm font-bold text-slate-500 mb-2">{item.step}</div>
                  <h3 className="text-xl font-semibold text-white mb-3">{item.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Features</span>
            <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
              Everything you need to close more deals
            </h2>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
              All the tools to find properties, reach owners, negotiate prices, and sell to buyers.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: "AI Writes Your Offers", desc: "AI handles conversations with property owners, asks the right questions, and negotiates price ranges for you.", icon: Bot },
              { title: "You Stay in Control", desc: "Review and approve any offer before it goes out. One tap to accept or reject from your phone.", icon: Shield },
              { title: "Messages That Get Delivered", desc: "Built-in compliance means your texts actually reach property owners, not spam folders.", icon: Zap },
              { title: "See What's Working", desc: "Track which messages get responses and which deals are moving forward.", icon: BarChart3 },
              { title: "Contracts in Seconds", desc: "Generate purchase agreements automatically when you reach a deal. E-signatures built in.", icon: FileText },
              { title: "Automated Follow-Up", desc: "AI sends personalized follow-ups until the owner responds. No leads slip through the cracks.", icon: MessageSquare },
            ].map((feature) => (
              <div key={feature.title} className="group rounded-xl border border-white/10 bg-[#1E293B]/30 p-6 transition-all hover:border-white/20 hover:bg-[#1E293B]/60">
                <div className="w-12 h-12 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center mb-4 group-hover:bg-[#3B82F6]/20 transition-colors">
                  <feature.icon className="h-6 w-6 text-[#3B82F6]" />
                </div>
                <h3 className="font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link
              href="/features"
              className="inline-flex items-center gap-2 text-[#3B82F6] font-medium hover:text-[#60A5FA] transition-colors"
            >
              View all features
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-[#0A0F1A]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Testimonials</span>
            <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
              Real results from real investors
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                name: "Marcus Johnson",
                role: "Real Estate Investor, Atlanta",
                quote: "Made $32K profit on my first deal in 6 weeks. The AI handled 80% of my conversations with property owners.",
                result: "$32,000",
                resultLabel: "First Deal Profit",
              },
              {
                name: "Sarah Chen",
                role: "Real Estate Investor, Phoenix",
                quote: "Switched from REsimpli. DealFlow saves me $200/month and finding buyers for my deals has doubled my close rate.",
                result: "2x",
                resultLabel: "Close Rate",
              },
              {
                name: "David Williams",
                role: "Team Lead, Houston",
                quote: "We went from 2 deals/month to 8 deals/month. The automation handles what used to take 3 virtual assistants.",
                result: "8",
                resultLabel: "Deals/Month",
              },
            ].map((testimonial, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-[#1E293B]/30 p-6">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-slate-300 mb-6 leading-relaxed">"{testimonial.quote}"</p>
                <div className="flex items-center justify-between pt-4 border-t border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
                      <span className="text-white text-sm font-medium">
                        {testimonial.name.split(" ").map(n => n[0]).join("")}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{testimonial.name}</p>
                      <p className="text-xs text-slate-500">{testimonial.role}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-400">{testimonial.result}</p>
                    <p className="text-xs text-slate-500">{testimonial.resultLabel}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI Calculator Section */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">ROI Calculator</span>
            <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
              See Your Potential Savings
            </h2>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
              Calculate how much time and money you could save with AI-powered lead automation.
            </p>
          </div>
          <ROICalculator />
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="py-24 bg-[#0A0F1A]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Pricing</span>
            <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
              Start free. Scale as you close deals. No hidden fees.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: "Free",
                price: "$0",
                period: "/mo",
                desc: "Try before you buy",
                features: ["25 emails/month", "5 AI credits", "Basic CRM", "Lead tracking"],
                cta: "Start Free",
                popular: false,
              },
              {
                name: "Pro",
                price: "$299",
                originalPrice: "$599",
                period: "/mo",
                desc: "For active investors",
                features: ["500 SMS/month", "5,000 emails/month", "2,500 AI credits", "AI handles negotiations", "Priority support"],
                cta: "Go Pro",
                popular: true,
              },
              {
                name: "Business",
                price: "$699",
                originalPrice: "$1,399",
                period: "/mo",
                desc: "For growing teams",
                features: ["1,500 SMS/month", "15,000 emails/month", "10,000 AI credits", "Team features", "API access"],
                cta: "Scale Up",
                popular: false,
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl p-8 ${
                  tier.popular
                    ? "border-2 border-[#3B82F6] bg-[#1E293B]/80"
                    : "border border-white/10 bg-[#1E293B]/30"
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-4 py-1 text-sm font-medium text-white">
                      <Star className="h-3.5 w-3.5 fill-white" />
                      Most Popular
                    </span>
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white">{tier.name}</h3>
                  <p className="text-sm text-slate-400 mt-1">{tier.desc}</p>
                </div>
                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">{tier.price}</span>
                    <span className="text-slate-400">{tier.period}</span>
                  </div>
                  {tier.originalPrice && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-slate-500 line-through">{tier.originalPrice}/mo</span>
                      <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                        50% OFF
                      </span>
                    </div>
                  )}
                </div>
                <ul className="space-y-3 mb-8">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-slate-300">
                      <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/account/signup?plan=${tier.name.toLowerCase()}`}
                  className={`block w-full text-center rounded-lg px-4 py-3 text-sm font-semibold transition-all ${
                    tier.popular
                      ? "bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white hover:opacity-90 shadow-lg shadow-blue-500/25"
                      : "bg-white/5 text-white border border-white/10 hover:bg-white/10"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-[#3B82F6] font-medium hover:text-[#60A5FA] transition-colors"
            >
              View all plans & compare
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ Preview */}
      <section className="py-24 bg-[#0A0F1A]">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">FAQ</span>
            <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
              Common questions
            </h2>
          </div>
          <div className="space-y-4">
            {[
              {
                q: "Does the AI send messages autonomously?",
                a: "The AI drafts and sends routine replies within limits you set, but it never states or confirms a price to a prospect on its own — any message that touches price, terms, or a decision point is held for your review and approval first.",
              },
              {
                q: "How long does setup take?",
                a: "Most teams are up and running in under an hour. Import your leads, connect Twilio, and launch your first campaign.",
              },
              {
                q: "Do I need coding experience?",
                a: "No. DealFlow AI is designed for real estate operators, not developers. Our onboarding flow guides you through everything.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. Month-to-month plans with no contracts. Cancel in one click from settings. 30-day money-back guarantee.",
              },
            ].map((faq, i) => (
              <details key={i} className="group rounded-xl border border-white/10 bg-[#1E293B]/30">
                <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                  <span className="font-medium text-white pr-4">{faq.q}</span>
                  <span className="text-slate-400 group-open:rotate-180 transition-transform">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </summary>
                <div className="px-6 pb-6 text-slate-400 leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link
              href="/faq"
              className="inline-flex items-center gap-2 text-[#3B82F6] font-medium hover:text-[#60A5FA] transition-colors"
            >
              View all FAQs
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Beta Pricing Banner */}
      <section className="py-12">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <BetaPricingBanner />
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-[#0A0F1A]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl">
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6]" />
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMtOS45NDEgMC0xOCA4LjA1OS0xOCAxOHM4LjA1OSAxOCAxOCAxOGM5Ljk0MSAwIDE4LTguMDU5IDE4LTE4cy04LjA1OS0xOC0xOC0xOHptMCAzMmMtNy43MzIgMC0xNC02LjI2OC0xNC0xNHM2LjI2OC0xNCAxNC0xNHMxNCA2LjI2OCAxNCAxNC02LjI2OCAxNC0xNCAxNHoiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjA1Ii8+PC9nPjwvc3ZnPg==')] opacity-30" />

            <div className="relative px-8 py-16 sm:px-16 sm:py-24 text-center">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                Ready to close more deals?
              </h2>
              <p className="text-lg text-white/80 mb-8 max-w-xl mx-auto">
                Join investors using AI to find homeowners ready to sell, negotiate better prices, and connect with buyers faster.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/account/signup"
                  className="inline-flex items-center justify-center gap-2 bg-white text-[#3B82F6] px-8 py-4 rounded-lg font-semibold hover:bg-white/90 transition-colors shadow-xl"
                >
                  Start 14-Day Free Trial
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white px-8 py-4 rounded-lg font-semibold hover:bg-white/10 transition-colors"
                >
                  Talk to Sales
                </Link>
              </div>
              {/* Guarantee badges */}
              <div className="mt-8">
                <GuaranteeBadgeRow
                  guarantees={['free-trial', 'no-credit-card', 'cancel-anytime', 'money-back']}
                  variant="compact"
                />
              </div>
            </div>
          </div>

          {/* Security/Trust badges */}
          <div className="mt-12">
            <SecurityBadges />
          </div>
        </div>
      </section>
    </div>
  );
}
