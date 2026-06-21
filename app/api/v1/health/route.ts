export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "frege-api",
    },
    { status: 200 },
  );
}
