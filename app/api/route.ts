import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const response = {
    message: `잘못들어오셨어요`,
    data: "없어요",
  };

  return NextResponse.json(response, { status: 200 });
}
