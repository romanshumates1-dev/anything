import type { Metadata } from "next";
import { ContactForm } from "./ContactForm";
import { Mail, MessageSquare, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact DealFlow AI for a demo, pricing questions, or enterprise inquiries. We'll respond within 1 business day.",
  openGraph: {
    title: "Contact DealFlow AI",
    description: "Get in touch for a demo, pricing questions, or enterprise inquiries.",
  },
};

export default function ContactPage() {
  return (
    <div className="bg-[#0F172A]">
      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Contact</span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">Get in touch</h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Have a question or want a demo? Fill out the form below and we'll respond within 1 business day.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Contact Info */}
            <div className="lg:col-span-1 space-y-6">
              {[
                {
                  icon: Mail,
                  title: "Email us",
                  desc: "Send us an email anytime",
                  contact: "support@dealflow.ai",
                  href: "mailto:support@dealflow.ai",
                },
                {
                  icon: MessageSquare,
                  title: "Live chat",
                  desc: "Available M-F, 9am-5pm EST",
                  contact: "Start a chat",
                  href: "#",
                },
                {
                  icon: Clock,
                  title: "Response time",
                  desc: "We typically respond within",
                  contact: "1 business day",
                  href: null,
                },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-white/10 bg-[#1E293B]/30 p-6">
                  <div className="w-10 h-10 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center mb-4">
                    <item.icon className="h-5 w-5 text-[#3B82F6]" />
                  </div>
                  <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                  <p className="text-sm text-slate-500 mb-2">{item.desc}</p>
                  {item.href ? (
                    <a href={item.href} className="text-sm text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
                      {item.contact}
                    </a>
                  ) : (
                    <span className="text-sm text-white font-medium">{item.contact}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-[#1E293B]/50 p-8">
              <ContactForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
