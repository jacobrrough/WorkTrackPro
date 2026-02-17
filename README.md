# WorkTrackPro

A comprehensive business management application for small to medium businesses, featuring inventory tracking, time clock, job management, and reporting capabilities.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS
- **Backend:** PocketBase (single executable, no Node/Express required)
- **Routing:** React Router DOM v7
- **Icons:** Material Symbols
- **Testing:** Vitest
- **Linting:** ESLint + Prettier

## Features

### Inventory Management
- Track stock levels, item details, suppliers, and purchases
- Allocated vs available stock calculation (committed to active jobs)
- Low stock alerts and reordering workflow
- Bin location tracking with barcode scanning
- Inventory history and transaction logging
- Category-based organization (Material, Foam, Trim & Cord, 3D Printing, Chemicals, Hardware, Misc Supplies)

### Time Clock
- Employee clock-in/clock-out system
- Job code scanning for quick clock-in
- Active shift tracking with live timer
- Geolocation support (via PocketBase hooks)

### Time Tracker
- Detailed time tracking for tasks, projects, and clients
- Time reports with filtering (today, week, month, all)
- View by shifts, users, or jobs
- Shift edit history tracking
- Hours calculation and formatting

### Job Tracker
- Kanban board views (Shop Floor and Admin)
- Job status workflow management
- Material allocation to jobs
- Comments and attachments
- Checklists with completion tracking
- Bin location assignment
- Rush job handling
- Expected completion dates (ECD) and due dates

### Additional Modules
- User roles and permissions (Admin/Employee)
- Admin console for job management
- Reporting dashboards
- File attachments (images, PDFs, documents)
- Responsive design for mobile and desktop

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- PocketBase server (included in `PocketBaseServer/` folder)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd WorkTrackPro_V5
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.template .env
```

Edit `.env` and set `VITE_POCKETBASE_URL` to your PocketBase server URL:
```
VITE_POCKETBASE_URL=http://192.168.1.100:8090
```

**Important:** Replace `192.168.1.100` with your computer's actual IP address for mobile device access.

4. Start PocketBase server:
```bash
cd PocketBaseServer
# Follow instructions in PocketBaseServer/README.md
# Or run START-SERVER-AUTO.bat (Windows)
```

5. Start the development server:
```bash
npm run dev
```

The app will be available at `https://localhost:3000` (or your configured port).

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Deploy to Vercel (roughcutmfg.com)

To host the app on Vercel and use your **roughcutmfg.com** domain (Squarespace), see **[DEPLOYMENT.md](./DEPLOYMENT.md)** for step-by-step instructions: connect your repo, set `VITE_POCKETBASE_URL`, and point the domain to Vercel.

### Docker Deployment

#### Using Docker Compose (Recommended)

1. Create a `.env` file with your PocketBase encryption key:
```bash
PB_ENCRYPTION_KEY=your-secure-encryption-key-here
```

2. Start services:
```bash
docker-compose up -d
```

The frontend will be available at `http://localhost:3000` and PocketBase at `http://localhost:8090`.

3. Stop services:
```bash
docker-compose down
```

#### Using Dockerfile Only

1. Build the image:
```bash
docker build -t worktrackpro .
```

2. Run the container:
```bash
docker run -p 3000:80 worktrackpro
```

**Note:** For production, configure PocketBase separately or use the docker-compose setup which includes both frontend and backend.

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode

### Project Structure

```
src/
├── services/api/      # API service modules (auth, jobs, shifts, inventory)
├── lib/               # Utility functions (timeUtils, inventoryCalculations)
├── components/        # React components
├── types.ts          # TypeScript type definitions
├── routes.tsx         # Route path helpers
├── App.tsx           # Main app component with routing
├── AppContext.tsx    # Global state management
└── test/             # Test setup and utilities
```

### Code Style

- ESLint for linting (see `eslint.config.js`)
- Prettier for formatting (see `.prettierrc`)
- TypeScript strict mode enabled
- Tailwind CSS for styling

## Configuration

### PocketBase Setup

1. Start PocketBase server (see `PocketBaseServer/README.md`)
2. Create collections: `users`, `jobs`, `shifts`, `inventory`, `job_inventory`, `comments`, `attachments`, `checklists`, `inventory_history`
3. Set up authentication rules and permissions
4. Configure file storage for attachments

### Environment Variables

- `VITE_POCKETBASE_URL` - PocketBase backend URL (default: `http://192.168.1.100:8090`)

### Vite Proxy

The Vite dev server proxies `/api` and `/_` requests to PocketBase. Update `vite.config.ts` if your PocketBase runs on a different port or host.

## Testing

Tests are written with Vitest and React Testing Library:

```bash
npm run test          # Run once
npm run test:watch    # Watch mode
```

Test files:
- `src/validation.test.ts` - Validation utilities
- `src/lib/timeUtils.test.ts` - Time calculation utilities
- `src/lib/inventoryCalculations.test.ts` - Inventory calculation logic

## Deployment

### Production Build

1. Build the app:
```bash
npm run build
```

2. Serve the `dist/` directory with a static file server (nginx, Apache, etc.)

3. Ensure PocketBase server is running and accessible

### Docker (Optional)

A Dockerfile can be added for containerized deployment. See `OVERHAUL_PLAN.md` for deployment recommendations.

## Security Notes

- Authentication handled by PocketBase
- HTTPS required for camera access on mobile devices
- Input validation on all forms
- File upload size limits (10MB default)
- Admin-only features protected by role checks

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Troubleshooting

### Camera not working
- Ensure HTTPS is enabled (required for camera access)
- Check browser permissions for camera access
- Verify PocketBase server is accessible

### Can't connect to PocketBase
- Check `VITE_POCKETBASE_URL` in `.env`
- Verify PocketBase server is running
- Check firewall settings
- For mobile: use your computer's IP address, not `localhost`

### Build errors
- Run `npm install` to ensure dependencies are installed
- Check Node.js version (18+ required)
- Clear `node_modules` and reinstall if needed

## Contributing

1. Follow the code style (ESLint + Prettier)
2. Write tests for new features
3. Update documentation as needed
4. Ensure all tests pass before submitting

## License

[Your License Here]

## Support

For issues and questions, please refer to the `OVERHAUL_PLAN.md` for detailed architecture and improvement plans.
