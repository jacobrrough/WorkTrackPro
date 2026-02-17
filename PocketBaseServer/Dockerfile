FROM alpine:latest

# Install dependencies
RUN apk add --no-cache ca-certificates unzip

# Download PocketBase (using latest stable version that supports JS migrations)
# Check latest version at: https://github.com/pocketbase/pocketbase/releases
ADD https://github.com/pocketbase/pocketbase/releases/download/v0.23.0/pocketbase_0.23.0_linux_amd64.zip /tmp/pb.zip

# Unzip and set permissions
RUN unzip /tmp/pb.zip -d /app && \
    chmod +x /app/pocketbase && \
    rm /tmp/pb.zip

# Copy migrations and hooks
COPY pb_migrations /app/pb_migrations
COPY pb_hooks /app/pb_hooks

WORKDIR /app

# Expose PocketBase port
EXPOSE 8090

# Start PocketBase
CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090"]
