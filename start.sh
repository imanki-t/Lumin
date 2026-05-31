#!/bin/bash
cd frontend && npm start &
sleep 5
node --max-old-space-size=512 --expose-gc index.js
