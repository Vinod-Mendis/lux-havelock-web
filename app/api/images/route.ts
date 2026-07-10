import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sinceId = searchParams.get('sinceId');

    const client = await clientPromise;
    const db = client.db('lux-havelock');
    
    let query = {};
    if (sinceId && sinceId !== 'undefined' && sinceId !== 'null' && sinceId.trim() !== '') {
      try {
        query = { _id: { $gt: new ObjectId(sinceId) } };
      } catch (err) {
        console.error('Invalid sinceId ObjectId:', sinceId);
      }
    }

    const images = await db
      .collection('images')
      .find(query)
      .sort({ _id: -1 })
      .toArray();

    return NextResponse.json({ success: true, images });
  } catch (error: any) {
    console.error('Error fetching images from MongoDB:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Database error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { id, imageUrl, phoneNumber, status = 'pending' } = await request.json();
    
    if ((!id && !imageUrl) || (status === 'pending' && !phoneNumber)) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db('lux-havelock');
    const collection = db.collection('images');

    let filter = {};
    if (id) {
      filter = { _id: new ObjectId(id) };
    } else {
      filter = { 'image-url': imageUrl };
    }

    const updateDoc: any = {
      status: status,
    };
    if (phoneNumber) {
      updateDoc['whatsapp-number'] = phoneNumber;
    }

    const updateResult = await collection.updateOne(filter, {
      $set: updateDoc,
      $unset: {
        error: '',
        failedAt: '',
        sentAt: '',
      },
    });

    if (updateResult.matchedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Image record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: 'Status updated to pending' });
  } catch (error: any) {
    console.error('Error updating status in MongoDB:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Database error' },
      { status: 500 }
    );
  }
}
