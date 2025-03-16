# Tailscale LocalAPI Client

A TypeScript client for interacting with Tailscale's LocalAPI.

## Status
🚧 **Work in Progress** 🚧

This project is under active development. Features and documentation are not yet complete.

## Overview
Simple TypeScript wrapper for communicating with the Tailscale daemon on your local machine via LocalAPI.

## Usage

### Whois Example
```typescript
import { TailscaleClient } from 'tailscale-localapi';

const ts = new TailscaleClient();

// Get information about a specific IP in your tailnet
const whoisInfo = await ts.whois('100.73.218.144');
console.log(whoisInfo);
```
