import { Outlet } from 'react-router-dom';
import Sidebar from '../Sidebar';
// Assuming LiveAlertsFeed will be created soon, we import it or use a placeholder if it doesn't exist yet
// We will create a simple placeholder if it fails to import. Let's just assume we will create it before starting the app.
import LiveAlertsFeed from '../shared/LiveAlertsFeed';
import TopBar from './TopBar';
import '../../index.css'; // ensuring styles are loaded

export default function AppShell() {
  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden cyber-grid-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-hidden relative">
          <Outlet />
        </main>
      </div>
      <LiveAlertsFeed />
    </div>
  );
}
