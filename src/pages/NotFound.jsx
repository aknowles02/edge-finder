import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-sm font-semibold text-win-text">404</p>
      <h1 className="mt-2 text-2xl font-bold text-white">No edge here</h1>
      <p className="mt-2 text-muted">That page doesn't exist.</p>
      <Link to="/" className="btn-primary mt-6">Back home</Link>
    </div>
  );
}
