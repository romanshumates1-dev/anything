import { NextRequest } from "next/server";

export async function POST(_request: NextRequest) {
  return Response.json(
    { message: "Contact form submission is not yet implemented." },
    { status: 501 }
  );
}
