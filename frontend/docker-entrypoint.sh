#!/bin/sh
set -eu

missing=""
for name in API_BASE_URL PUBLIC_API_KEY USER_API_KEY ADMIN_BFF_API_KEY; do
	value="$(printenv "$name" 2>/dev/null || true)"
	if [ -z "$value" ]; then
		missing="${missing}${missing:+, }${name}"
	fi
done

if [ -n "$missing" ]; then
	echo "Missing required frontend runtime configuration: $missing" >&2
	exit 78
fi

case "$API_BASE_URL" in
	http://*|https://*) ;;
	*)
		echo "API_BASE_URL must be an absolute HTTP(S) URL" >&2
		exit 78
		;;
esac

if [ "$PUBLIC_API_KEY" = "$USER_API_KEY" ] || \
	[ "$PUBLIC_API_KEY" = "$ADMIN_BFF_API_KEY" ] || \
	[ "$USER_API_KEY" = "$ADMIN_BFF_API_KEY" ]; then
	echo "Frontend scoped API keys must use three distinct values" >&2
	exit 78
fi

exec "$@"
