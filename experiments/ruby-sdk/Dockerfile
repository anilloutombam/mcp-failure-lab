FROM node:22-bookworm@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384 AS node

FROM ruby:3.4-bookworm

COPY --from=node /usr/local/ /usr/local/

WORKDIR /workspace
COPY Gemfile ./
RUN bundle install
COPY run.rb ./

ENTRYPOINT ["bundle", "exec", "ruby", "run.rb"]
