import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '../../components/ui/primitives'

/** Shown when a route does not exist (for example, an old link kept in a bookmark). */
export function NotFoundScreen(): ReactNode {
  const location = useLocation()
  return (
    <div className="auth-layout">
      <div className="auth-card stack" style={{ textAlign: 'center', alignItems: 'center' }}>
        <span className="state__icon">
          <Compass size={22} />
        </span>
        <h1 className="auth-card__title">This screen does not exist</h1>
        <p className="muted">
          Dentiva Pro has no page at <code>{location.pathname}</code>. It may have been removed in a later version.
        </p>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Button variant="primary">Go to the dashboard</Button>
        </Link>
      </div>
    </div>
  )
}
