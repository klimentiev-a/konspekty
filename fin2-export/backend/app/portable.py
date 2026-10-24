"""Same public application; private router definitions are excluded in the clone."""
import os
if len(os.environ.get('ADMIN_TOKEN',''))<32:
    raise RuntimeError('Set your own ADMIN_TOKEN (32+ characters) before running the public clone.')
from fastapi.routing import APIRoute
from .main import app
_private=('/api/clients','/api/portfolio','/api/reports','/api/builder')
app.router.routes[:]=[r for r in app.router.routes if not (isinstance(r,APIRoute) and any(r.path.startswith(p) for p in _private))]
