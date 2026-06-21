import { authenticatePrototypeRequest, prototypeUnauthorized } from "@/lib/prototype/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await authenticatePrototypeRequest(req);
    if (!auth) return prototypeUnauthorized();

    return Response.json(
      {
        organization: auth.organization,
        role: auth.role,
        key: auth.key,
        allowed_labels: auth.allowedLabels,
        capabilities: auth.capabilities,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error("prototype auth context failed", {
      message: (err as Error)?.message,
    });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
