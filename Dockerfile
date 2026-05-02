FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app
# Install all dependencies for the build
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS final
WORKDIR /usr/src/app

# Only copy what is strictly necessary for production
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/package.json ./package.json

# Install ONLY production dependencies to keep the image slim
RUN pnpm install --prod --frozen-lockfile

# Expose the port your express server listens on (likely 3000)
EXPOSE 7860

CMD [ "node", "dist/server.js" ]