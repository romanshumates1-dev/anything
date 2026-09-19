'use client';

import { useState, useEffect } from 'react';
import { Star, Quote, CheckCircle } from 'lucide-react';

export interface Testimonial {
  id?: string;
  name: string;
  role: string;
  location?: string;
  company?: string;
  quote: string;
  result?: string;
  resultLabel?: string;
  avatar?: string;
  rating?: number;
  verified?: boolean;
  dateAdded?: string;
}

interface TestimonialCardProps {
  testimonial: Testimonial;
  variant?: 'default' | 'compact' | 'featured';
  showResult?: boolean;
  className?: string;
}

/**
 * TestimonialCard - Display customer testimonials ethically
 *
 * Ethical guidelines:
 * - Only use real testimonials with permission
 * - Mark as "verified" only if actually verified
 * - Show realistic results, not outliers presented as typical
 * - Include context (role, location) for credibility
 */
export function TestimonialCard({
  testimonial,
  variant = 'default',
  showResult = true,
  className = '',
}: TestimonialCardProps) {
  const {
    name,
    role,
    location,
    company,
    quote,
    result,
    resultLabel,
    avatar,
    rating = 5,
    verified,
  } = testimonial;

  const getInitials = (n: string) =>
    n
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  if (variant === 'compact') {
    return (
      <div className={`p-4 rounded-xl border border-white/10 bg-[#1E293B]/30 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            {avatar ? (
              <img src={avatar} alt={name} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
                <span className="text-white text-sm font-medium">{getInitials(name)}</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-300 line-clamp-2">"{quote}"</p>
            <p className="text-xs text-slate-500 mt-2">
              {name} - {role}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'featured') {
    return (
      <div className={`relative p-8 rounded-2xl border border-white/10 bg-[#1E293B]/50 ${className}`}>
        <Quote className="absolute top-6 left-6 h-8 w-8 text-[#3B82F6]/20" />
        <div className="relative">
          <div className="flex gap-1 mb-4">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={`h-5 w-5 ${
                  i < rating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
                }`}
              />
            ))}
          </div>
          <p className="text-lg text-slate-200 leading-relaxed mb-6">"{quote}"</p>
          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            <div className="flex items-center gap-4">
              {avatar ? (
                <img src={avatar} alt={name} className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
                  <span className="text-white font-semibold">{getInitials(name)}</span>
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-white">{name}</p>
                  {verified && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle className="h-3 w-3" />
                      Verified
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400">
                  {role}
                  {company && ` at ${company}`}
                  {location && ` - ${location}`}
                </p>
              </div>
            </div>
            {showResult && result && (
              <div className="text-right">
                <p className="text-2xl font-bold text-emerald-400">{result}</p>
                {resultLabel && <p className="text-xs text-slate-500">{resultLabel}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div className={`rounded-2xl border border-white/10 bg-[#1E293B]/30 p-6 ${className}`}>
      <div className="flex gap-1 mb-4">
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            className={`h-4 w-4 ${
              i < rating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
            }`}
          />
        ))}
      </div>
      <p className="text-slate-300 mb-6 leading-relaxed">"{quote}"</p>
      <div className="flex items-center justify-between pt-4 border-t border-white/10">
        <div className="flex items-center gap-3">
          {avatar ? (
            <img src={avatar} alt={name} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
              <span className="text-white text-sm font-medium">{getInitials(name)}</span>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-white">{name}</p>
              {verified && <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />}
            </div>
            <p className="text-xs text-slate-500">
              {role}
              {location && ` - ${location}`}
            </p>
          </div>
        </div>
        {showResult && result && (
          <div className="text-right">
            <p className="text-lg font-bold text-emerald-400">{result}</p>
            {resultLabel && <p className="text-xs text-slate-500">{resultLabel}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * TestimonialCarousel - Auto-rotating testimonials
 */
interface TestimonialCarouselProps {
  testimonials: Testimonial[];
  autoPlay?: boolean;
  interval?: number;
  className?: string;
}

export function TestimonialCarousel({
  testimonials,
  autoPlay = true,
  interval = 5000,
  className = '',
}: TestimonialCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!autoPlay || testimonials.length <= 1) return;

    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % testimonials.length);
    }, interval);

    return () => clearInterval(timer);
  }, [autoPlay, interval, testimonials.length]);

  return (
    <div className={className}>
      <div className="relative overflow-hidden">
        <TestimonialCard
          testimonial={testimonials[activeIndex]}
          variant="featured"
        />
      </div>
      {testimonials.length > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {testimonials.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === activeIndex
                  ? 'bg-[#3B82F6] w-6'
                  : 'bg-white/20 hover:bg-white/40'
              }`}
              aria-label={`Go to testimonial ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
