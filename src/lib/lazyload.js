export function createLazyLoader(callback) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const element = entry.target;
          const src = element.dataset.src;
          const type = element.dataset.type;
          
          if (src) {
            if (type === "video") {
              element.poster = src;
            } else {
              element.src = src;
            }
            delete element.dataset.src;
            observer.unobserve(element);
          }
        }
      });
    },
    {
      rootMargin: "100px",
      threshold: 0.01
    }
  );
  
  return {
    observe(element) {
      observer.observe(element);
    },
    unobserve(element) {
      observer.unobserve(element);
    },
    disconnect() {
      observer.disconnect();
    }
  };
}

export async function generateThumbnail(blob, maxWidth = 200, maxHeight = 200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      
      let width = img.width;
      let height = img.height;
      
      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (thumbnailBlob) => {
          resolve(thumbnailBlob);
        },
        "image/jpeg",
        quality
      );
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    
    img.src = url;
  });
}

export class VirtualScroll {
  constructor(container, itemHeight, renderItem) {
    this.container = container;
    this.itemHeight = itemHeight;
    this.renderItem = renderItem;
    this.items = [];
    this.scrollTop = 0;
    this.containerHeight = 0;
    
    this.handleScroll = this.handleScroll.bind(this);
    this.container.addEventListener("scroll", this.handleScroll);
  }
  
  setItems(items) {
    this.items = items;
    this.render();
  }
  
  handleScroll() {
    this.scrollTop = this.container.scrollTop;
    this.render();
  }
  
  render() {
    const visibleCount = Math.ceil(this.containerHeight / this.itemHeight) + 2;
    const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - 1);
    const endIndex = Math.min(this.items.length, startIndex + visibleCount);
    
    const totalHeight = this.items.length * this.itemHeight;
    const offsetY = startIndex * this.itemHeight;
    
    const content = this.items.slice(startIndex, endIndex).map((item, index) =>
      this.renderItem(item, startIndex + index)
    ).join("");
    
    this.container.innerHTML = `
      <div style="height: ${totalHeight}px; position: relative;">
        <div style="position: absolute; top: ${offsetY}px; left: 0; right: 0;">
          ${content}
        </div>
      </div>
    `;
    
    this.containerHeight = this.container.clientHeight;
  }
  
  destroy() {
    this.container.removeEventListener("scroll", this.handleScroll);
  }
}
