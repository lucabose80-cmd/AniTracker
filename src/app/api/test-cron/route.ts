import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function GET() {
  try {
    const snap = await adminDb.collection('users').limit(1).get();
    return NextResponse.json({ ok: true, count: snap.size });
  } catch(e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack, name: e.name }, { status: 500 });
  }
}
