'use client';

import { Star, TrendingUp, DollarSign, Users } from 'lucide-react';

interface Testimonial {
  name: string;
  role: string;
  location: string;
  quote: string;
  result: string;
  avatar?: string;
}

interface SocialProofProps {
  testimonials?: Testimonial[];
  stats?: {
    users?: number;
    deals?: number;
    revenue?: string;
    rating?: number;
  };
}

const DEFAULT_TESTIMONIALS: Testimonial[] = [
  {
    name: 'Marcus Johnson',
    role: 'Solo Wholesaler',
    location: 'Atlanta, GA',
    quote: 'Closed my first $32K assignment fee in 6 weeks. The AI negotiation literally handled 80% of my seller conversations.',
    result: '$32,000 deal',
  },
  {
    name: 'Sarah Chen',
    role: 'Real Estate Investor',
    location: 'Phoenix, AZ',
    quote: 'Switched from REsimpli. DealFlow saves me $200/month and the buyer matching alone has doubled my close rate.',
    result: '2x close rate',
  },
  {
    name: 'David Williams',
    role: 'Team Lead',
    location: 'Houston, TX',
    quote: 'We went from 2 deals/month to 8 deals/month. The automation handles what used to take 3 VAs.',
    result: '8 deals/month',
  },
  {
    name: 'Jennifer Martinez',
    role: 'New Investor',
    location: 'Miami, FL',
    quote: 'As a complete beginner, the AI walked me through everything. First deal in 45 days with zero cold calling.',
    result: '45 days to first deal',
  },
];

const DEFAULT_STATS = {
  users: 500,
  deals: 1247,
  revenue: '$18.5M',
  rating: 4.9,
};

export function SocialProof({
  testimonials = DEFAULT_TESTIMONIALS,
  stats = DEFAULT_STATS,
}: SocialProofProps) {
  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();

  return (
    <div className="w-full">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        <div className="bg-white rounded-xl border p-6 text-center">
          <Users className="h-6 w-6 text-blue-500 mx-auto mb-2" />
          <div className="text-3xl font-bold text-gray-900">{stats.users}+</div>
          <div className="text-sm text-gray-500">Active Users</div>
        </div>
        <div className="bg-white rounded-xl border p-6 text-center">
          <TrendingUp className="h-6 w-6 text-green-500 mx-auto mb-2" />
          <div className="text-3xl font-bold text-gray-900">{(stats.deals ?? 0).toLocaleString()}</div>
          <div className="text-sm text-gray-500">Deals Closed</div>
        </div>
        <div className="bg-white rounded-xl border p-6 text-center">
          <DollarSign className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
          <div className="text-3xl font-bold text-gray-900">{stats.revenue}</div>
          <div className="text-sm text-gray-500">Deal Volume</div>
        </div>
        <div className="bg-white rounded-xl border p-6 text-center">
          <Star className="h-6 w-6 text-yellow-500 mx-auto mb-2" />
          <div className="text-3xl font-bold text-gray-900">{stats.rating}</div>
          <div className="text-sm text-gray-500">User Rating</div>
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">Real Results from Real Wholesalers</h2>
        <p className="text-gray-600">Join {stats.users}+ investors already closing more deals with AI</p>
      </div>

      {/* Testimonials Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {testimonials.map((t, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                {t.avatar ? (
                  <img
                    src={t.avatar}
                    alt={t.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold">
                    {getInitials(t.name)}
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1 mb-1">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-700 text-sm mb-3">"{t.quote}"</p>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{t.name}</div>
                    <div className="text-xs text-gray-500">
                      {t.role} - {t.location}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Result</div>
                    <div className="text-sm font-bold text-green-600">{t.result}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Trust Badges */}
      <div className="mt-10 flex flex-wrap justify-center gap-6 items-center text-gray-400">
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
          </svg>
          <span className="text-sm">SOC 2 Compliant</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
          </svg>
          <span className="text-sm">256-bit Encryption</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17l4.59-4.59L16 11l-6 6z" />
          </svg>
          <span className="text-sm">99.9% Uptime</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <span className="text-sm">30-Day Guarantee</span>
        </div>
      </div>
    </div>
  );
}
