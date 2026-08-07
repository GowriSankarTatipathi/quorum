#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 EC2 instance to run the QUORUM stack.
# Run once, as the default `ubuntu` user:
#
#   bash deploy/aws/bootstrap.sh
#
set -euo pipefail

echo "==> Installing Docker"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
	-o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
	sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
	docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"

# The Next.js build and the Playwright image both peak well above what a 4 GB
# box has free. Swap costs nothing when idle and turns an OOM-killed build into
# a slow one.
if [ ! -f /swapfile ]; then
	echo "==> Adding 4G swap"
	sudo fallocate -l 4G /swapfile
	sudo chmod 600 /swapfile
	sudo mkswap /swapfile
	sudo swapon /swapfile
	echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo
echo "Done. Log out and back in so the docker group applies, then:"
echo "  cd ~/quorum && cp deploy/aws/env.example deploy/aws/.env"
echo "  nano deploy/aws/.env      # fill in every value"
echo "  docker compose -f deploy/aws/docker-compose.prod.yml --env-file deploy/aws/.env up -d --build"
