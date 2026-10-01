import { NextResponse } from 'next/server';
import { CURRENT_APP_VERSION } from '@/lib/version';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== 'Bearer anitracker123' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const { adminDb } = await import('@/lib/firebase-admin');
  await adminDb.collection('app_config').doc('version').set({ version: CURRENT_APP_VERSION });
  return NextResponse.json({ success: true, version: CURRENT_APP_VERSION });
}
