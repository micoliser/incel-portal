import time
from io import BytesIO
from urllib.parse import urlparse
from django.core.management.base import BaseCommand
from django.conf import settings
from PIL import Image, UnidentifiedImageError

from inventory.models import InventoryItem
from inventory.s3 import extract_inventory_photo_key_from_public_url, _s3_client

class Command(BaseCommand):
    help = 'Compresses existing inventory images stored on S3 to < 300KB and 1280px.'

    def handle(self, *args, **options):
        items = InventoryItem.objects.exclude(photo_url="")
        total_items = items.count()
        self.stdout.write(self.style.SUCCESS(f"Found {total_items} items with photo_url"))

        if total_items == 0:
            return

        s3 = _s3_client()
        bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()

        if not bucket_name:
            self.stdout.write(self.style.ERROR('AWS_S3_BUCKET_NAME is not configured.'))
            return

        success_count = 0
        skip_count = 0
        error_count = 0

        for idx, item in enumerate(items, start=1):
            public_url = item.photo_url
            key = extract_inventory_photo_key_from_public_url(public_url)

            if not key:
                self.stdout.write(self.style.WARNING(f"[{idx}/{total_items}] Could not extract S3 key for item {item.id} URL: {public_url}"))
                skip_count += 1
                continue
                
            try:
                # 1. Download
                response = s3.get_object(Bucket=bucket_name, Key=key)
                image_data = response['Body'].read()
                original_size = len(image_data)

                if original_size < 100 * 1024:
                    # Skip if already very small (e.g., < 100KB)
                    self.stdout.write(f"[{idx}/{total_items}] Item {item.id}: Skipped (already small: {original_size // 1024}KB)")
                    skip_count += 1
                    continue

                # 2. Compress
                try:
                    img = Image.open(BytesIO(image_data))
                except UnidentifiedImageError:
                    self.stdout.write(self.style.WARNING(f"[{idx}/{total_items}] Item {item.id}: Skipped (not a recognized image format)"))
                    skip_count += 1
                    continue

                # Only compress raster images
                if img.format not in ['JPEG', 'PNG', 'WEBP', 'MPO']:
                    self.stdout.write(f"[{idx}/{total_items}] Item {item.id}: Skipped (format {img.format})")
                    skip_count += 1
                    continue

                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")

                # Resize to max 1280px
                max_size = 1280
                if img.width > max_size or img.height > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

                output = BytesIO()
                # Use WEBP if it was WEBP, otherwise JPEG for compression
                save_format = 'WEBP' if img.format == 'WEBP' else 'JPEG'
                content_type = 'image/webp' if save_format == 'WEBP' else 'image/jpeg'
                
                img.save(output, format=save_format, quality=85, optimize=True)
                compressed_data = output.getvalue()
                compressed_size = len(compressed_data)

                if compressed_size >= original_size:
                    self.stdout.write(f"[{idx}/{total_items}] Item {item.id}: Skipped (compression did not reduce size)")
                    skip_count += 1
                    continue

                # 3. Re-upload
                s3.put_object(
                    Bucket=bucket_name,
                    Key=key,
                    Body=compressed_data,
                    ContentType=content_type
                )

                self.stdout.write(self.style.SUCCESS(f"[{idx}/{total_items}] Item {item.id}: Compressed {original_size // 1024}KB -> {compressed_size // 1024}KB"))
                success_count += 1

            except Exception as e:
                self.stdout.write(self.style.ERROR(f"[{idx}/{total_items}] Item {item.id}: Failed with error: {e}"))
                error_count += 1

        self.stdout.write(self.style.SUCCESS(f"\nDone! Processed: {total_items}, Compressed: {success_count}, Skipped: {skip_count}, Errors: {error_count}"))
