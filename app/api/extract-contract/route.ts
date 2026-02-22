import { GoogleGenerativeAI } from "@google/generative-ai"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text } = body as { text: string }

    if (!text) {
      return NextResponse.json(
        { error: "Request body must include a 'text' field." },
        { status: 400 }
      )
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    const prompt = `You are an AI trained to extract logistics contract rates for Indian D2C brands. Read the following contract text and extract the exact pricing rules. Return ONLY a valid JSON object (no markdown, no backticks) with these exact keys: providerName (string), zoneARate (number), zoneBRate (number), zoneCRate (number), codPercentage (number), rtoFlatFee (number). If a value is missing, use 0.

Contract text:
${text}`

    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()

    const extracted = JSON.parse(raw)

    return NextResponse.json(extracted)
  } catch (error) {
    console.error("[extract-contract] Error:", error)
    return NextResponse.json(
      { error: "Failed to extract contract data." },
      { status: 500 }
    )
  }
}
