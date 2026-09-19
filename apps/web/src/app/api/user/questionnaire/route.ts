import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/user/questionnaire
 * Check if the user has completed the questionnaire and get current responses
 */
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [response] = await sql`
      SELECT
        id,
        experience_level,
        deals_per_month,
        team_size,
        primary_market,
        current_tools,
        biggest_challenge,
        how_heard_about_us,
        budget_range,
        goals,
        completed_at,
        skipped_at,
        reminder_dismissed_at,
        created_at
      FROM public.user_questionnaire_responses
      WHERE user_id = ${session.userId}
      LIMIT 1
    `;

    if (!response) {
      return NextResponse.json({
        completed: false,
        skipped: false,
        reminderDismissed: false,
        response: null,
      });
    }

    return NextResponse.json({
      completed: !!response.completed_at,
      skipped: !!response.skipped_at,
      reminderDismissed: !!response.reminder_dismissed_at,
      response: {
        id: response.id,
        experienceLevel: response.experience_level,
        dealsPerMonth: response.deals_per_month,
        teamSize: response.team_size,
        primaryMarket: response.primary_market,
        currentTools: response.current_tools || [],
        biggestChallenge: response.biggest_challenge,
        howHeardAboutUs: response.how_heard_about_us,
        budgetRange: response.budget_range,
        goals: response.goals,
        completedAt: response.completed_at,
        createdAt: response.created_at,
      },
    });
  } catch (error) {
    console.error('[QUESTIONNAIRE] Error fetching questionnaire:', error);
    return NextResponse.json({ error: 'Failed to fetch questionnaire' }, { status: 500 });
  }
}

/**
 * POST /api/user/questionnaire
 * Save questionnaire responses (can be partial or complete)
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      experienceLevel,
      dealsPerMonth,
      teamSize,
      primaryMarket,
      currentTools,
      biggestChallenge,
      howHeardAboutUs,
      budgetRange,
      goals,
      isComplete,
      isSkipped,
      dismissReminder,
    } = body;

    // Validate enums
    const validExperienceLevels = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
    const validDealsPerMonth = ['0', '1-2', '3-5', '6-10', '10+'];
    const validTeamSizes = ['solo', '2-5', '6-10', '10+'];
    const validMarkets = ['residential', 'commercial', 'land', 'mixed'];
    const validChallenges = ['lead_gen', 'follow_up', 'closing', 'scaling', 'other'];
    const validSources = ['google', 'social', 'referral', 'podcast', 'youtube', 'other'];
    const validBudgets = ['bootstrap', '50-200', '200-500', '500+'];

    // Validate if provided
    if (experienceLevel && !validExperienceLevels.includes(experienceLevel)) {
      return NextResponse.json({ error: 'Invalid experience level' }, { status: 400 });
    }
    if (dealsPerMonth && !validDealsPerMonth.includes(dealsPerMonth)) {
      return NextResponse.json({ error: 'Invalid deals per month value' }, { status: 400 });
    }
    if (teamSize && !validTeamSizes.includes(teamSize)) {
      return NextResponse.json({ error: 'Invalid team size' }, { status: 400 });
    }
    if (primaryMarket && !validMarkets.includes(primaryMarket)) {
      return NextResponse.json({ error: 'Invalid primary market' }, { status: 400 });
    }
    if (biggestChallenge && !validChallenges.includes(biggestChallenge)) {
      return NextResponse.json({ error: 'Invalid challenge' }, { status: 400 });
    }
    if (howHeardAboutUs && !validSources.includes(howHeardAboutUs)) {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
    }
    if (budgetRange && !validBudgets.includes(budgetRange)) {
      return NextResponse.json({ error: 'Invalid budget range' }, { status: 400 });
    }

    // Sanitize goals text
    const sanitizedGoals = goals ? String(goals).slice(0, 1000) : null;

    // Sanitize current tools array
    const sanitizedTools = Array.isArray(currentTools)
      ? currentTools.filter((t): t is string => typeof t === 'string').slice(0, 10)
      : null;

    // Check if a response already exists
    const [existing] = await sql`
      SELECT id FROM public.user_questionnaire_responses
      WHERE user_id = ${session.userId}
      LIMIT 1
    `;

    if (existing) {
      // Update existing response
      await sql`
        UPDATE public.user_questionnaire_responses
        SET
          experience_level = COALESCE(${experienceLevel || null}, experience_level),
          deals_per_month = COALESCE(${dealsPerMonth || null}, deals_per_month),
          team_size = COALESCE(${teamSize || null}, team_size),
          primary_market = COALESCE(${primaryMarket || null}, primary_market),
          current_tools = COALESCE(${sanitizedTools}, current_tools),
          biggest_challenge = COALESCE(${biggestChallenge || null}, biggest_challenge),
          how_heard_about_us = COALESCE(${howHeardAboutUs || null}, how_heard_about_us),
          budget_range = COALESCE(${budgetRange || null}, budget_range),
          goals = COALESCE(${sanitizedGoals}, goals),
          completed_at = CASE WHEN ${isComplete} = true THEN now() ELSE completed_at END,
          skipped_at = CASE WHEN ${isSkipped} = true THEN now() ELSE skipped_at END,
          reminder_dismissed_at = CASE WHEN ${dismissReminder} = true THEN now() ELSE reminder_dismissed_at END
        WHERE user_id = ${session.userId}
      `;
    } else {
      // Insert new response
      await sql`
        INSERT INTO public.user_questionnaire_responses (
          user_id,
          experience_level,
          deals_per_month,
          team_size,
          primary_market,
          current_tools,
          biggest_challenge,
          how_heard_about_us,
          budget_range,
          goals,
          completed_at,
          skipped_at,
          reminder_dismissed_at
        ) VALUES (
          ${session.userId},
          ${experienceLevel || null},
          ${dealsPerMonth || null},
          ${teamSize || null},
          ${primaryMarket || null},
          ${sanitizedTools},
          ${biggestChallenge || null},
          ${howHeardAboutUs || null},
          ${budgetRange || null},
          ${sanitizedGoals},
          ${isComplete ? sql`now()` : null},
          ${isSkipped ? sql`now()` : null},
          ${dismissReminder ? sql`now()` : null}
        )
      `;
    }

    // Update user table if complete or skipped
    if (isComplete || isSkipped) {
      await sql`
        UPDATE "user"
        SET questionnaire_completed = true
        WHERE id = ${session.userId}
      `;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[QUESTIONNAIRE] Error saving questionnaire:', error);
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 });
  }
}
