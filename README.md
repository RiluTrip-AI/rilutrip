# RiluTrip

An AI-powered travel planning web application built with Next.js 15, React, Supabase, and Google Gemini 2.0 Flash.

## Features

- 🤖 AI-powered itinerary generation using Gemini 2.0 Flash
- 🗺️ Interactive Google Maps integration
- 💬 Conversational chat interface for itinerary refinement
- 🤝 Real-time collaborative editing with Yjs
- 📱 Mobile-responsive design
- 🌓 Dark/Light theme support
- 🔐 Secure authentication with Google OAuth

### Route Optimization

- Optimizes itinerary day order with cached Google Routes API Compute Route Matrix data.
- Uses ORS Vroom when `ORS_API_KEY` is available, then falls back to the local greedy optimizer.
- Preserves activity time windows from opening hours, meal windows, and daily start/end settings.
- Applies authenticated credit capture, per-user rate limiting, and trusted `day_matrices` cache writes in the `optimize-route` Supabase Edge Function.

## Tech Stack

### Frontend

- **Next.js 15** - React framework with App Router
- **React 18** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS v4** - Styling
- **Shadcn/ui** - UI components

### Backend

- **Supabase** - PostgreSQL database, authentication, and real-time features
- **Supabase Edge Functions** - Serverless functions for AI integration and route optimization
- **Google Gemini 2.0 Flash** - AI model for itinerary generation

### Collaboration

- **Yjs** - CRDT for conflict-free collaborative editing
- **y-websocket** - WebSocket provider for real-time sync

### Testing

- **Vitest** - Unit testing framework
- **fast-check** - Property-based testing
- **@testing-library/react** - React component testing

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account
- Google Cloud account (for Maps API and OAuth)
- Google AI Studio account (for Gemini API)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd aitravelplanner
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env
```

Edit `.env.local` and add your API keys:

- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` - Your Google Maps API key (domain-restricted)

Server-side secrets are stored in Supabase Edge Function environment (configure in the Supabase dashboard under Edge Functions secrets):

- `GEMINI_API_KEY` - Used by `generate-itinerary` and `chat`
- `GOOGLE_MAPS_API_KEY` - Server-side Google Maps key for Places resolution and Routes API Compute Route Matrix in the `optimize-route` Edge Function
- `ORS_API_KEY` - OpenRouteService API key for the `optimize-route` Edge Function; it falls back to the local greedy optimizer when omitted

4. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

5. (Optional) Run the Yjs WebSocket server for real-time collaboration:

```bash
cd yjs-server
cp .env.example .env
# Edit .env and add your Supabase credentials:
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# Use the client access token for RLS; do not use the service role key here.
npm install
npm run dev
```

The Yjs server will run on port 1234 by default. For production deployment, see the [Yjs Server Deployment](#yjs-server-deployment) section.

### Testing

Run unit tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run tests with UI:

```bash
npm run test:ui
```

### Building for Production

```bash
npm run build
npm start
```

## Yjs Server Deployment

The Yjs WebSocket server enables real-time collaborative editing. It runs as a separate Node.js process.

### Local Development

```bash
cd yjs-server
npm run dev
```

### Production Deployment (VM)

1. Build the server:

```bash
cd yjs-server
npm install
npm run build
```

2. Configure environment variables in `yjs-server/.env`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PORT=1234
MAX_CONNECTIONS_PER_ROOM=20
```

3. Start with PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Enable auto-restart on system reboot
```

4. Configure Cloudflare Tunnel to expose the server:

```bash
cloudflared tunnel --url http://localhost:1234
```

Point your domain (e.g., `wss://yjs.rilutrip.com`) to the tunnel.

5. Update the Next.js app environment variable:

```bash
NEXT_PUBLIC_YJS_SERVER_URL=wss://yjs.rilutrip.com
```

### Server Features

- **JWT Authentication**: Validates Supabase access tokens
- **Per-room Connection Limits**: Prevents room overcrowding (default: 20 users/room)
- **Automatic Reconnection**: Handles network interruptions gracefully
- **Health Check Endpoint**: `GET /` returns `ok` for monitoring

## API Documentation

### `/api/resolve-places`

用於將地點名稱轉換為詳細的 Google Maps 資訊（包含經緯度、評分、營業時間等）。此 API 會透過 Supabase Edge Function 代理請求，並使用資料庫快取來節省 Google Maps API 呼叫額度。

**Endpoint:** `POST /api/resolve-places`

**Authentication:** Required (需在 Header 提供 `Authorization: Bearer <Supabase Access Token>`)

**Request Body:**

```json
{
  "places": [
    {
      "id": "1", // 必填：自訂 ID，用於對應回傳結果
      "name": "台北101", // 必填：搜尋的地點名稱 (長度 1~50)
      "lat": 25.0339, // 選填：用於提高搜尋精準度的基準緯度
      "lng": 121.5644 // 選填：用於提高搜尋精準度的基準經度
    }
  ]
}
```

_備註：每次請求的 `places` 數量必須介於 1 到 10 之間。_

**Response:**
回傳狀態碼 `200 OK` 及以下 JSON 結構：

```json
{
  "resolved": [
    {
      "id": "1",                           // 對應請求時傳入的 ID
      "place_id": "ChIJ...",               // Google Maps Place ID (若找到的話)
      "name": "Taipei 101",                // Google Maps 上的正式名稱 (或 fallback 原名稱)
      "lat": 25.0339639,                   // (選填) 緯度
      "lng": 121.5644722,                  // (選填) 經度
      "rating": 4.6,                       // (選填) 地點評分
      "user_ratings_total": 85000,         // (選填) 評論總數
      "website": "https://www.taipei-101.com.tw/", // (選填) 官方網站
      "opening_hours": { ... },            // (選填) 營業時間結構
      "error": "NOT_FOUND"                 // (選填) 若地點找不到則會有此欄位
    }
  ]
}
```

## Project Structure

```
├── app/                      # Next.js App Router
│   ├── (auth)/              # Authentication routes
│   ├── (main)/              # Main application routes
│   ├── api/                 # API routes
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Landing page
│   └── globals.css          # Global styles
├── components/              # React components
│   ├── ui/                  # Shared UI components
│   ├── landing/             # Landing page components
│   ├── planner/             # Planning interface components
│   └── layout/              # Layout components
├── lib/                     # Core libraries
│   ├── supabase/            # Supabase integration
│   ├── gemini/              # Gemini AI integration
│   ├── maps/                # Google Maps integration
│   ├── collaboration/       # Yjs collaboration
│   └── utils/               # Utility functions
├── hooks/                   # Custom React hooks
├── types/                   # TypeScript type definitions
├── test/                    # Test files and utilities
│   ├── utils/               # Test helpers
│   └── setup.ts             # Test setup
├── supabase/                # Supabase configuration
│   ├── migrations/          # Database migrations
│   └── functions/           # Edge Functions
└── yjs-server/              # Yjs WebSocket server (separate Node.js app)
    ├── src/                 # Server source code
    │   ├── index.ts         # Main server entry point
    │   ├── auth.ts          # JWT verification
    │   └── room-manager.ts  # Connection management
    ├── ecosystem.config.cjs # PM2 configuration
    └── package.json         # Server dependencies
```

## Architecture

The application follows the Single Responsibility Principle (SRP) with a layered architecture:

1. **Presentation Layer** - React components with Gen Z-styled UI/UX
2. **Application Layer** - Business logic and state management
3. **Integration Layer** - API clients for external services
4. **Data Layer** - Supabase database and real-time synchronization

## Development Guidelines

### Code Style

- Use TypeScript strict mode
- Follow ESLint and Prettier configurations
- Write tests for all new features
- Use property-based testing for universal properties

### Testing Strategy

- **Unit Tests** - Specific examples and edge cases
- **Property-Based Tests** - Universal properties across all inputs
- Minimum 100 iterations per property test

### Commit Guidelines

- Write clear, descriptive commit messages
- Reference issue numbers when applicable
- Keep commits focused and atomic

## License

[Your License Here]

## Contributing

[Your Contributing Guidelines Here]
