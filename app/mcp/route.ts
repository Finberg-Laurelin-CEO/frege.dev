import { handleHostedMcpRequest } from "@/lib/core/mcp-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  return handleHostedMcpRequest(req);
}

export async function GET(req: Request) {
  return handleHostedMcpRequest(req);
}

export async function DELETE(req: Request) {
  return handleHostedMcpRequest(req);
}

export async function PUT(req: Request) {
  return handleHostedMcpRequest(req);
}

export async function PATCH(req: Request) {
  return handleHostedMcpRequest(req);
}

export async function OPTIONS(req: Request) {
  return handleHostedMcpRequest(req);
}
