const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

const Club = require('./models/Club');
const Event = require('./models/Event');
const Venue = require('./models/Venue');
const ClubBudget = require('./models/ClubBudget');
const Equipment = require('./models/Equipment');
const Announcement = require('./models/Announcement');

async function seed() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required to seed CampusSphere.');
  await mongoose.connect(process.env.MONGO_URI);

  const [auditorium, techLab] = await Promise.all([
    Venue.findOneAndUpdate(
      { name: 'Main Auditorium' },
      { $setOnInsert: { capacity: 500, location: 'Academic Block A' } },
      { new: true, upsert: true, runValidators: true },
    ),
    Venue.findOneAndUpdate(
      { name: 'Innovation Lab' },
      { $setOnInsert: { capacity: 60, location: 'Computer Science Department' } },
      { new: true, upsert: true, runValidators: true },
    ),
  ]);

  const [communityClub, techClub] = await Promise.all([
    Club.findOneAndUpdate(
      { name: 'Campus Connect' },
      {
        $setOnInsert: {
          description: 'Bring students together through campus-wide experiences, volunteering, and community.',
          category: 'Community',
          clubType: 'non_technical',
          recruitmentOpen: true,
        },
      },
      { new: true, upsert: true, runValidators: true },
    ),
    Club.findOneAndUpdate(
      { name: 'Microsoft Student Club' },
      {
        $setOnInsert: {
          description: 'A student-led technology community for workshops, hackathons, and emerging ideas.',
          category: 'Technology',
          clubType: 'technical',
          recruitmentOpen: true,
        },
      },
      { new: true, upsert: true, runValidators: true },
    ),
  ]);
  await Promise.all([
    Club.updateOne({ _id: communityClub._id }, { $set: { clubType: 'non_technical' } }),
    Club.updateOne({ _id: techClub._id }, { $set: { clubType: 'technical' } }),
    Club.updateOne(
      { _id: communityClub._id, recruitmentOpen: { $exists: false } },
      { $set: { recruitmentOpen: true } },
    ),
    Club.updateOne(
      { _id: techClub._id, recruitmentOpen: { $exists: false } },
      { $set: { recruitmentOpen: true } },
    ),
  ]);

  const events = [
    {
      title: 'Build Night: Ideas to Impact',
      description: 'An evening of collaborative prototyping, practical demos, and good ideas made real.',
      eventDate: new Date('2026-11-12T17:00:00'),
      clubId: techClub._id,
      venueId: techLab._id,
      capacity: 60,
      eventType: 'technical',
    },
    {
      title: 'Campus Connect Open House',
      description: 'Meet student organizers, discover campus communities, and find your next thing.',
      eventDate: new Date('2026-11-19T16:00:00'),
      clubId: communityClub._id,
      venueId: auditorium._id,
      capacity: 250,
      eventType: 'non_technical',
    },
  ];

  for (const event of events) {
    await Event.findOneAndUpdate(
      { title: event.title, clubId: event.clubId },
      { $setOnInsert: { ...event, status: 'approved' } },
      { upsert: true, runValidators: true },
    );
    await Event.updateOne(
      { title: event.title, clubId: event.clubId },
      { $set: { eventType: event.eventType } },
    );
  }

  const seedOnly = async (Model, filter, values) => Model.findOneAndUpdate(
    filter,
    { $setOnInsert: values },
    { upsert: true, runValidators: true },
  );

  await Promise.all([
    seedOnly(ClubBudget, { clubId: techClub._id, academicYear: '2026-2027' }, {
      totalAllocated: 50000,
      totalSpent: 12500,
    }),
    seedOnly(ClubBudget, { clubId: communityClub._id, academicYear: '2026-2027' }, {
      totalAllocated: 80000,
      totalSpent: 45000,
    }),
    seedOnly(Equipment, { clubId: techClub._id, name: 'Raspberry Pi Kits' }, {
      description: 'Starter kits for hands-on prototyping sessions.',
      totalQuantity: 15,
      availableQuantity: 15,
      condition: 'good',
    }),
    seedOnly(Equipment, { clubId: communityClub._id, name: 'Portable PA System' }, {
      description: 'Portable audio equipment for campus gatherings.',
      totalQuantity: 2,
      availableQuantity: 2,
      condition: 'good',
    }),
    seedOnly(Announcement, { clubId: techClub._id, title: 'Build Night registrations are open' }, {
      content: 'Save your seat for an evening of prototyping and practical technology demos.',
      priority: 'high',
    }),
    seedOnly(Announcement, { clubId: communityClub._id, title: 'Meet your campus community' }, {
      content: 'Join our open house to meet student organizers and explore clubs across campus.',
      priority: 'normal',
    }),
  ]);

  console.log('CampusSphere sample data is ready. Existing data was preserved.');
}

seed()
  .catch((error) => {
    console.error('CampusSphere seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
